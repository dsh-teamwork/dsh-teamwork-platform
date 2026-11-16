package wire

import "strings"

// SubmissionInput is a draft: a complete configuration and an explicit update base.
type SubmissionInput struct {
	Config      ConfigInput `json:"config"`
	ConfigID    string      `json:"configId,omitempty"`
	BaseVersion int         `json:"baseVersion"`
	Revision    int         `json:"revision,omitempty"`
	Note        string      `json:"note"`
}

func (in *SubmissionInput) Validate() error {
	if err := in.Config.Validate(); err != nil {
		return err
	}
	var is Issues
	if in.Config.Kind != "preset" && in.Config.Kind != "plugin" {
		is.Add("Share a preset or plugin", "config", "kind")
	}
	if len(in.ConfigID) > 32 || in.BaseVersion < 0 || (in.ConfigID == "" && in.BaseVersion != 0) || in.Revision < 0 {
		is.Add("Invalid update base", "baseVersion")
	}
	in.Note = strings.TrimSpace(in.Note)
	maxLen(&is, in.Note, 2000, "note")
	return is.Err()
}

type ReviewInput struct {
	Revision int    `json:"revision"`
	Reason   string `json:"reason"`
}

func (in *ReviewInput) Validate() error {
	var is Issues
	if in.Revision < 1 {
		is.Add("A positive revision", "revision")
	}
	in.Reason = strings.TrimSpace(in.Reason)
	maxLen(&is, in.Reason, 2000, "reason")
	return is.Err()
}
