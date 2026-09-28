//go:build ignore

package main

import (
	"fmt"
	"github.com/maxmind/mmdbwriter"
	"github.com/maxmind/mmdbwriter/mmdbtype"
	"net"
	"os"
)

func main() {
	for _, kind := range []string{"City", "Country"} {
		tree, err := mmdbwriter.New(mmdbwriter.Options{DatabaseType: "Towbar-Test-" + kind, Description: map[string]string{"en": "Synthetic Towbar geolocation test fixture"}, IPVersion: 6, BuildEpoch: 1788220800, Languages: []string{"en"}})
		if err != nil {
			panic(err)
		}
		insert := func(network, country, city, region string) {
			_, ipnet, err := net.ParseCIDR(network)
			if err != nil {
				panic(err)
			}
			record := mmdbtype.Map{"country": mmdbtype.Map{"iso_code": mmdbtype.String(country)}}
			if kind == "City" && city != "" {
				record["city"] = mmdbtype.Map{"names": mmdbtype.Map{"en": mmdbtype.String(city)}}
				record["subdivisions"] = mmdbtype.Slice{mmdbtype.Map{"names": mmdbtype.Map{"en": mmdbtype.String(region)}}}
			}
			if err := tree.Insert(ipnet, record); err != nil {
				panic(err)
			}
		}
		insert("8.8.8.8/32", "US", "Mountain View", "California")
		insert("1.1.1.1/32", "IN", "Chennai", "Tamil Nadu")
		insert("9.9.9.9/32", "US", "", "")
		insert("2001:4860:4860::8888/128", "BR", "São Paulo", "São Paulo")
		for i := 0; i < 150; i++ {
			insert(fmt.Sprintf("11.%d.%d.%d/32", i, (i*37)%255, (i*53)%255), "IN", "", "")
		}
		f, err := os.Create(os.Args[1] + "/" + kind + ".mmdb")
		if err != nil {
			panic(err)
		}
		if _, err := tree.WriteTo(f); err != nil {
			panic(err)
		}
		f.Close()
	}
}
