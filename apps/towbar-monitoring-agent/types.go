package main

import "time"

const Version = "1.3.0"
const sampleInterval = 30 * time.Second
const maxQueueBytes = 10 * 1024 * 1024
const maxQueueAge = time.Hour
const maxSampleBytes = 1024 * 1024
const maxEntities = 512

type Entity struct {
	ID           string             `json:"id"`
	DeployableID string             `json:"deployableId,omitempty"`
	DeploymentID string             `json:"deploymentId,omitempty"`
	PreviewID    string             `json:"previewId,omitempty"`
	ContainerID  string             `json:"containerId,omitempty"`
	State        string             `json:"state,omitempty"`
	Health       string             `json:"health,omitempty"`
	Metrics      map[string]float64 `json:"metrics"`
}
type HostIdentity struct {
	BootID        string         `json:"bootId"`
	BootStartedAt time.Time      `json:"bootStartedAt"`
	Instance      *CloudInstance `json:"instance,omitempty"`
}
type CloudInstance struct {
	Provider string `json:"provider"`
	Type     string `json:"type"`
}
type Sample struct {
	Host                   *HostIdentity               `json:"host,omitempty"`
	TunnelPeers            map[string][]string         `json:"tunnelPeers,omitempty"`
	AnalyticsServices      []AnalyticsServiceReadiness `json:"analyticsServices,omitempty"`
	AnalyticsListenerReady bool                        `json:"analyticsListenerReady"`
	AnalyticsGeoBuiltAt    string                      `json:"analyticsGeoBuiltAt,omitempty"`
	Analytics              []AnalyticsCell             `json:"analytics,omitempty"`
	AnalyticsDropped       uint64                      `json:"analyticsDropped,omitempty"`
	ID                     string                      `json:"id"`
	CollectedAt            time.Time                   `json:"collectedAt"`
	Version                string                      `json:"version"`
	CollectionDurationMs   int64                       `json:"collectionDurationMs"`
	CollectionErrors       int                         `json:"collectionErrors"`
	DroppedSamples         uint64                      `json:"droppedSamples"`
	Entities               []Entity                    `json:"entities"`
}
type Config struct {
	ServerID string `json:"serverId"`
	Endpoint string `json:"endpoint"`
	Token    string `json:"token"`
}
