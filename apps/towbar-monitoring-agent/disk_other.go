//go:build !linux

package main

import "errors"

func diskSpace(path string) (float64, float64, error) {
	return 0, 0, errors.New("Linux is required for filesystem metrics")
}
