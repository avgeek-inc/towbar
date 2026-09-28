These small MMDB fixtures contain invented locations for fixed public IPs. They exercise the provider's city/country record structure, IPv4 and IPv6 lookups, and migration from the old country database. They contain no visitor data and are not real geolocation estimates.

To regenerate, copy `generate.go` into a temporary directory, run `go mod init towbar-geo-fixtures` and `go get github.com/maxmind/mmdbwriter@v1.1.0`, then run `go run generate.go /absolute/path/to/testdata/geo`. The writer is used only to generate test fixtures; Scout has no new dependency.
