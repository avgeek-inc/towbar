package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Each file is one bounded sample. Atomic renames protect against interruption;
// age and size limits are enforced before adding another sample.
type Queue struct {
	Dir     string
	Dropped uint64
}

func atomicWrite(path string, data []byte, mode os.FileMode) error {
	tmp := path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}
func (q *Queue) files() ([]os.DirEntry, error) {
	entries, err := os.ReadDir(q.Dir)
	if err != nil {
		return nil, err
	}
	files := []os.DirEntry{}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			files = append(files, e)
		}
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Name() < files[j].Name() })
	return files, nil
}
func (q *Queue) prune(now time.Time, reserve int64) error {
	before := q.Dropped
	// Incomplete writes from a killed sender must not accumulate across restarts.
	entries, err := os.ReadDir(q.Dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".tmp") {
			if err := os.Remove(filepath.Join(q.Dir, entry.Name())); err != nil {
				return err
			}
		}
	}
	files, err := q.files()
	if err != nil {
		return err
	}
	var total int64
	for _, f := range files {
		info, e := f.Info()
		if e != nil {
			return e
		}
		total += info.Size()
	}
	for _, f := range files {
		info, e := f.Info()
		if e != nil {
			return e
		}
		if now.Sub(info.ModTime()) > maxQueueAge || total+reserve > maxQueueBytes {
			if e = os.Remove(filepath.Join(q.Dir, f.Name())); e != nil {
				return e
			}
			total -= info.Size()
			q.Dropped++
		}
	}
	if before != q.Dropped {
		return q.persistDropped()
	}
	return nil
}
func (q *Queue) persistDropped() error {
	return atomicWrite(filepath.Join(q.Dir, "dropped"), []byte(strconv.FormatUint(q.Dropped, 10)), 0600)
}
func (q *Queue) restoreDropped() {
	data, err := os.ReadFile(filepath.Join(q.Dir, "dropped"))
	if err != nil {
		return
	}
	if count, err := strconv.ParseUint(string(data), 10, 64); err == nil {
		q.Dropped = count
	}
}
func (q *Queue) add(sample Sample, now time.Time) error {
	if err := os.MkdirAll(q.Dir, 0700); err != nil {
		return err
	}
	if err := q.prune(now, maxSampleBytes); err != nil {
		return err
	}
	sample.DroppedSamples = q.Dropped
	data, err := json.Marshal(sample)
	if err != nil {
		return err
	}
	if len(data) > maxSampleBytes {
		q.Dropped++
		return errors.New("sample exceeds size limit")
	}
	name := sample.CollectedAt.UTC().Format("20060102T150405.000000000") + ".json"
	return atomicWrite(filepath.Join(q.Dir, name), data, 0600)
}
func (q *Queue) next(now time.Time) (string, []byte, error) {
	if err := q.prune(now, 0); err != nil {
		return "", nil, err
	}
	files, err := q.files()
	if err != nil || len(files) == 0 {
		return "", nil, err
	}
	path := filepath.Join(q.Dir, files[0].Name())
	info, err := os.Stat(path)
	if err != nil {
		return "", nil, err
	}
	if info.Size() > maxSampleBytes {
		_ = os.Remove(path)
		q.Dropped++
		return "", nil, errors.New("oversized queued sample")
	}
	data, err := os.ReadFile(path)
	return path, data, err
}

// The state directory is a systemd bind mount. Remove its contents, not the
// mount point, which can reject RemoveAll before it visits queued files.
func (q *Queue) clear() error {
	entries, err := os.ReadDir(q.Dir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := os.RemoveAll(filepath.Join(q.Dir, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}
