package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type counter struct {
	values map[string]float64
	at     time.Time
}
type collector struct {
	proc     string
	client   *http.Client
	previous map[string]counter
}

func newCollector() *collector {
	transport := &http.Transport{MaxConnsPerHost: 4, MaxIdleConnsPerHost: 4, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 3 * time.Second}).DialContext(ctx, "unix", "/var/run/docker.sock")
	}}
	return &collector{proc: "/proc", client: &http.Client{Transport: transport, Timeout: 4 * time.Second}, previous: map[string]counter{}}
}
func number(s string) float64 { v, _ := strconv.ParseFloat(s, 64); return v }
func (c *collector) read(file string) (string, error) {
	b, e := os.ReadFile(filepath.Join(c.proc, file))
	return string(b), e
}
func parseCPU(text string) (total, idle, cores float64) {
	for _, line := range strings.Split(text, "\n") {
		f := strings.Fields(line)
		if len(f) == 0 {
			continue
		}
		if f[0] == "cpu" && len(f) >= 5 {
			for i := 1; i < len(f) && i <= 8; i++ {
				total += number(f[i])
			}
			idle = number(f[4])
			if len(f) > 5 {
				idle += number(f[5])
			}
		} else if strings.HasPrefix(f[0], "cpu") {
			cores++
		}
	}
	return
}
func parseMemory(text string) map[string]float64 {
	vals := map[string]float64{}
	for _, line := range strings.Split(text, "\n") {
		f := strings.Fields(line)
		if len(f) > 1 {
			vals[strings.TrimSuffix(f[0], ":")] = number(f[1]) * 1024
		}
	}
	out := map[string]float64{}
	if total := vals["MemTotal"]; total > 0 {
		out["memoryTotalBytes"] = total
		out["memoryUsedBytes"] = max(0, total-vals["MemAvailable"])
		out["memoryPercent"] = out["memoryUsedBytes"] / total * 100
	}
	out["swapTotalBytes"] = vals["SwapTotal"]
	out["swapUsedBytes"] = max(0, vals["SwapTotal"]-vals["SwapFree"])
	return out
}
func parseNetwork(text string) (rx, tx float64) {
	for _, line := range strings.Split(text, "\n") {
		pair := strings.SplitN(line, ":", 2)
		if len(pair) != 2 {
			continue
		}
		name := strings.TrimSpace(pair[0])
		if name == "lo" || strings.HasPrefix(name, "veth") || strings.HasPrefix(name, "docker") || strings.HasPrefix(name, "br-") {
			continue
		}
		f := strings.Fields(pair[1])
		if len(f) > 8 {
			rx += number(f[0])
			tx += number(f[8])
		}
	}
	return
}
func delta(now, old float64) float64 { return max(0, now-old) }
func rate(now, old float64, seconds float64) float64 {
	if seconds <= 0 {
		return 0
	}
	return delta(now, old) / seconds
}
func (c *collector) collect(ctx context.Context, now time.Time) Sample {
	started := time.Now()
	sample := Sample{ID: randomID(), CollectedAt: now.UTC(), Version: Version, Entities: []Entity{}}
	next := map[string]counter{}
	host := Entity{ID: "host", Metrics: map[string]float64{}}
	raw := map[string]float64{}
	cpu, e := c.read("stat")
	if e != nil {
		sample.CollectionErrors++
	} else {
		total, idle, cores := parseCPU(cpu)
		raw["cpu"] = total
		raw["idle"] = idle
		host.Metrics["cpuCores"] = cores
	}
	memory, e := c.read("meminfo")
	if e != nil {
		sample.CollectionErrors++
	} else {
		for k, v := range parseMemory(memory) {
			host.Metrics[k] = v
		}
	}
	network, e := c.read("net/dev")
	if e != nil {
		sample.CollectionErrors++
	} else {
		raw["rx"], raw["tx"] = parseNetwork(network)
	}
	if uptime, e := c.read("uptime"); e == nil {
		f := strings.Fields(uptime)
		if len(f) > 0 {
			host.Metrics["uptimeSeconds"] = number(f[0])
		}
	} else {
		sample.CollectionErrors++
	}
	if load, e := c.read("loadavg"); e == nil {
		f := strings.Fields(load)
		if len(f) > 2 {
			host.Metrics["load1"] = number(f[0])
			host.Metrics["load5"] = number(f[1])
			host.Metrics["load15"] = number(f[2])
		}
	} else {
		sample.CollectionErrors++
	}
	if disk, e := c.read("diskstats"); e == nil {
		for _, line := range strings.Split(disk, "\n") {
			f := strings.Fields(line)
			if len(f) < 14 {
				continue
			}
			if _, e := os.Stat("/sys/block/" + f[2]); e != nil || strings.HasPrefix(f[2], "loop") || strings.HasPrefix(f[2], "ram") || strings.HasPrefix(f[2], "dm-") {
				continue
			}
			raw["read"] += number(f[5]) * 512
			raw["write"] += number(f[9]) * 512
		}
	} else {
		sample.CollectionErrors++
	}
	for _, disk := range []struct{ path, prefix string }{{"/", "disk"}, {"/var/lib/docker", "dockerDisk"}} {
		total, available, e := diskSpace(disk.path)
		if e != nil {
			sample.CollectionErrors++
			continue
		}
		host.Metrics[disk.prefix+"TotalBytes"] = total
		host.Metrics[disk.prefix+"UsedBytes"] = max(0, total-available)
		if total > 0 {
			host.Metrics[disk.prefix+"Percent"] = (total - available) / total * 100
		}
	}
	if old, ok := c.previous["host"]; ok {
		seconds := now.Sub(old.at).Seconds()
		_, currentCPU := raw["cpu"]
		_, previousCPU := old.values["cpu"]
		if total := delta(raw["cpu"], old.values["cpu"]); currentCPU && previousCPU && total > 0 {
			host.Metrics["cpuPercent"] = min(100, max(0, (total-delta(raw["idle"], old.values["idle"]))/total*100))
		}
		for _, pair := range [][2]string{{"rx", "networkRxBytesPerSecond"}, {"tx", "networkTxBytesPerSecond"}, {"read", "diskReadBytesPerSecond"}, {"write", "diskWriteBytesPerSecond"}} {
			current, currentOK := raw[pair[0]]
			previous, previousOK := old.values[pair[0]]
			if currentOK && previousOK {
				host.Metrics[pair[1]] = rate(current, previous, seconds)
			}
		}
	}
	next["host"] = counter{raw, now}
	sample.Entities = append(sample.Entities, host)
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	entities, counters, errs := c.containers(ctx, now)
	sample.Entities = append(sample.Entities, entities...)
	sample.CollectionErrors += errs
	for k, v := range counters {
		next[k] = v
	}
	// Replacing this map prevents stopped/replaced containers accumulating forever.
	c.previous = next
	sample.CollectionDurationMs = time.Since(started).Milliseconds()
	return sample
}
func (c *collector) get(ctx context.Context, path string, out any) error {
	req, e := http.NewRequestWithContext(ctx, http.MethodGet, "http://docker"+path, nil)
	if e != nil {
		return e
	}
	res, e := c.client.Do(req)
	if e != nil {
		return e
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("Docker returned %d", res.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(res.Body, 4*1024*1024)).Decode(out)
}

type dockerContainer struct {
	ID     string            `json:"Id"`
	Labels map[string]string `json:"Labels"`
	State  string            `json:"State"`
}
type dockerStats struct {
	CPU struct {
		Usage struct {
			Total float64 `json:"total_usage"`
		} `json:"cpu_usage"`
		System float64 `json:"system_cpu_usage"`
		Online float64 `json:"online_cpus"`
	} `json:"cpu_stats"`
	Memory struct {
		Usage float64            `json:"usage"`
		Limit float64            `json:"limit"`
		Stats map[string]float64 `json:"stats"`
	} `json:"memory_stats"`
	Networks map[string]struct {
		Rx float64 `json:"rx_bytes"`
		Tx float64 `json:"tx_bytes"`
	} `json:"networks"`
	Block struct {
		Entries []struct {
			Op    string  `json:"op"`
			Value float64 `json:"value"`
		} `json:"io_service_bytes_recursive"`
	} `json:"blkio_stats"`
}
type dockerInspection struct {
	Restarts float64 `json:"RestartCount"`
	State    struct {
		Health struct {
			Status string `json:"Status"`
		} `json:"Health"`
	} `json:"State"`
	HostConfig struct {
		NanoCPUs  float64 `json:"NanoCpus"`
		CPUQuota  float64 `json:"CpuQuota"`
		CPUPeriod float64 `json:"CpuPeriod"`
		Memory    float64 `json:"Memory"`
	} `json:"HostConfig"`
}

func (c *collector) containers(ctx context.Context, now time.Time) ([]Entity, map[string]counter, int) {
	var list []dockerContainer
	if e := c.get(ctx, "/containers/json?all=true&filters=%7B%22label%22%3A%5B%22towbar.managed%3Dtrue%22%5D%7D", &list); e != nil {
		return nil, nil, 1
	}
	entities := []Entity{}
	next := map[string]counter{}
	errs := 0
	if len(list) > maxEntities {
		errs++
		list = list[:maxEntities]
	}
	var mutex sync.Mutex
	var wg sync.WaitGroup
	slots := make(chan struct{}, 4)
collectContainers:
	for _, item := range list {
		if item.Labels["towbar.managed"] != "true" || item.Labels["towbar.deployable"] == "" || item.Labels["towbar.source"] == "" {
			continue
		}
		select {
		case slots <- struct{}{}:
		case <-ctx.Done():
			mutex.Lock()
			errs++
			mutex.Unlock()
			break collectContainers
		}
		wg.Add(1)
		go func(item dockerContainer) {
			defer wg.Done()
			defer func() { <-slots }()
			entity, counts, e := c.container(ctx, item, now)
			mutex.Lock()
			defer mutex.Unlock()
			if e != nil {
				errs++
			}
			entities = append(entities, entity)
			if counts != nil {
				next[item.ID] = counter{counts, now}
			}
		}(item)
	}
	wg.Wait()
	return entities, next, errs
}
func (c *collector) container(ctx context.Context, item dockerContainer, now time.Time) (Entity, map[string]float64, error) {
	entity := Entity{ID: item.ID, ContainerID: item.ID, DeployableID: item.Labels["towbar.deployable"], DeploymentID: item.Labels["towbar.deployment"], PreviewID: item.Labels["towbar.preview"], State: item.State, Metrics: map[string]float64{}}
	var inspection dockerInspection
	if e := c.get(ctx, "/containers/"+item.ID+"/json", &inspection); e != nil {
		return entity, nil, e
	}
	entity.Health = inspection.State.Health.Status
	entity.Metrics["restartCount"] = inspection.Restarts
	if item.State != "running" {
		return entity, nil, nil
	}
	var stats dockerStats
	if e := c.get(ctx, "/containers/"+item.ID+"/stats?stream=false&one-shot=true", &stats); e != nil {
		return entity, nil, e
	}
	cache, exists := stats.Memory.Stats["inactive_file"]
	if !exists {
		cache = stats.Memory.Stats["total_inactive_file"]
	}
	used := stats.Memory.Usage
	if cache < used {
		used -= cache
	}
	entity.Metrics["memoryUsedBytes"] = used
	entity.Metrics["memoryLimitBytes"] = stats.Memory.Limit
	if stats.Memory.Limit > 0 {
		entity.Metrics["memoryPercent"] = used / stats.Memory.Limit * 100
	}
	if inspection.HostConfig.NanoCPUs > 0 {
		entity.Metrics["cpuLimitCores"] = inspection.HostConfig.NanoCPUs / 1e9
	} else if inspection.HostConfig.CPUQuota > 0 && inspection.HostConfig.CPUPeriod > 0 {
		entity.Metrics["cpuLimitCores"] = inspection.HostConfig.CPUQuota / inspection.HostConfig.CPUPeriod
	}
	raw := map[string]float64{"cpu": stats.CPU.Usage.Total, "system": stats.CPU.System}
	for _, n := range stats.Networks {
		raw["rx"] += n.Rx
		raw["tx"] += n.Tx
	}
	for _, b := range stats.Block.Entries {
		switch strings.ToLower(b.Op) {
		case "read":
			raw["read"] += b.Value
		case "write":
			raw["write"] += b.Value
		}
	}
	if old, ok := c.previous[item.ID]; ok {
		if system := delta(raw["system"], old.values["system"]); system > 0 {
			cores := delta(raw["cpu"], old.values["cpu"]) / system * stats.CPU.Online
			entity.Metrics["cpuCores"] = cores
			if limit := entity.Metrics["cpuLimitCores"]; limit > 0 {
				entity.Metrics["cpuPercent"] = cores / limit * 100
			} else if stats.CPU.Online > 0 {
				entity.Metrics["cpuPercent"] = cores / stats.CPU.Online * 100
			}
		}
		seconds := now.Sub(old.at).Seconds()
		for _, pair := range [][2]string{{"rx", "networkRxBytesPerSecond"}, {"tx", "networkTxBytesPerSecond"}, {"read", "diskReadBytesPerSecond"}, {"write", "diskWriteBytesPerSecond"}} {
			entity.Metrics[pair[1]] = rate(raw[pair[0]], old.values[pair[0]], seconds)
		}
	}
	return entity, raw, nil
}
