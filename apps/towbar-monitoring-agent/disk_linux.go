package main

import "syscall"

func diskSpace(path string) (float64, float64, error) {
	var s syscall.Statfs_t
	err := syscall.Statfs(path, &s)
	return float64(s.Blocks) * float64(s.Bsize), float64(s.Bavail) * float64(s.Bsize), err
}
