package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var bootIDPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)
var ec2TypePattern = regexp.MustCompile(`^[a-z][a-z0-9-]*\.[a-z0-9]+$`)

func (c *collector) hostIdentity(now time.Time, metrics map[string]float64) *HostIdentity {
	id, err := c.read("sys/kernel/random/boot_id")
	id = strings.TrimSpace(id)
	if err != nil || !bootIDPattern.MatchString(id) {
		return nil
	}
	uptime, ok := metrics["uptimeSeconds"]
	if !ok {
		return nil
	}
	started := now.Add(-time.Duration(uptime * float64(time.Second))).UTC()
	if stat, err := c.read("stat"); err == nil {
		for _, line := range strings.Split(stat, "\n") {
			fields := strings.Fields(line)
			if len(fields) == 2 && fields[0] == "btime" && number(fields[1]) > 0 {
				started = time.Unix(int64(number(fields[1])), 0).UTC()
			}
		}
	}
	identity := &HostIdentity{BootID: id, BootStartedAt: started}
	// EC2 exposes the current instance type in DMI, including on Graviton.
	// Reading these two files preserves the collector's AF_UNIX-only sandbox.
	vendor, vendorErr := os.ReadFile(filepath.Join(c.dmi, "sys_vendor"))
	product, productErr := os.ReadFile(filepath.Join(c.dmi, "product_name"))
	instanceType := strings.TrimSpace(string(product))
	if vendorErr == nil && productErr == nil && strings.TrimSpace(string(vendor)) == "Amazon EC2" && len(instanceType) <= 128 && ec2TypePattern.MatchString(instanceType) {
		identity.Instance = &CloudInstance{Provider: "aws", Type: instanceType}
	}
	return identity
}
