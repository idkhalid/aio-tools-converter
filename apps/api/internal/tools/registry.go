package tools

import "strings"

const (
	DocxToPDFToolID      = "document.docx-to-pdf"
	OfficeToPDFProcessor = "office-docx-to-pdf"
)

// Definition is the server-authoritative portion of a tool definition. The
// browser cannot choose a processor or raise these limits.
type Definition struct {
	ID                string
	ProcessorID       string
	MaxFiles          int
	MaxInputBytes     int64
	AcceptedExtension string
	AcceptedMIMETypes map[string]struct{}
}

var registry = map[string]Definition{
	DocxToPDFToolID: {
		ID:                DocxToPDFToolID,
		ProcessorID:       OfficeToPDFProcessor,
		MaxFiles:          1,
		MaxInputBytes:     50 * 1024 * 1024,
		AcceptedExtension: ".docx",
		AcceptedMIMETypes: map[string]struct{}{
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document": {},
			"application/octet-stream": {},
			"application/zip":          {},
		},
	},
}

func Lookup(id string) (Definition, bool) {
	definition, ok := registry[id]
	return definition, ok
}

func (d Definition) AcceptsMIME(value string) bool {
	value = strings.ToLower(strings.TrimSpace(strings.SplitN(value, ";", 2)[0]))
	_, ok := d.AcceptedMIMETypes[value]
	return ok
}
