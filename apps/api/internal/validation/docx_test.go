package validation

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const officialDOCXMIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

func TestDOCXAcceptsValidOOXML(t *testing.T) {
	filePath := writeDOCX(t, nil)
	err := DOCX("document.DOCX", officialDOCXMIME, filePath, 1024*1024, acceptedTestMIME)
	if err != nil {
		t.Fatalf("valid DOCX rejected: %v", err)
	}
}

func TestDOCXRejectsIndependentClaimMismatch(t *testing.T) {
	filePath := writeDOCX(t, nil)
	tests := []struct {
		name, filename, mime string
	}{
		{"extension", "document.zip", officialDOCXMIME},
		{"mime", "document.docx", "text/plain"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := DOCX(test.filename, test.mime, filePath, 1024*1024, acceptedTestMIME); err == nil {
				t.Fatal("expected invalid DOCX")
			}
		})
	}
}

func TestDOCXRejectsMalformedContainers(t *testing.T) {
	t.Run("bad signature", func(t *testing.T) {
		filePath := filepath.Join(t.TempDir(), "bad.docx")
		if err := os.WriteFile(filePath, []byte("not a zip"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := DOCX("bad.docx", officialDOCXMIME, filePath, 1024, acceptedTestMIME); err == nil {
			t.Fatal("expected invalid signature")
		}
	})

	tests := map[string]map[string]string{
		"missing document": {"word/document.xml": ""},
		"path traversal":   {"../escape": "bad"},
		"macro content type": {
			"[Content_Types].xml": strings.Replace(validContentTypes(), docxMainContentType, "application/vnd.ms-word.document.macroEnabled.main+xml", 1),
		},
	}
	for name, changes := range tests {
		t.Run(name, func(t *testing.T) {
			filePath := writeDOCX(t, changes)
			if err := DOCX("bad.docx", officialDOCXMIME, filePath, 1024*1024, acceptedTestMIME); err == nil {
				t.Fatal("expected invalid DOCX")
			}
		})
	}
}

func writeDOCX(t *testing.T, changes map[string]string) string {
	t.Helper()
	parts := map[string]string{
		"[Content_Types].xml": validContentTypes(),
		"_rels/.rels":         `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
		"word/document.xml":   `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Test</w:t></w:r></w:p></w:body></w:document>`,
	}
	for name, value := range changes {
		if value == "" {
			delete(parts, name)
		} else {
			parts[name] = value
		}
	}
	filePath := filepath.Join(t.TempDir(), "fixture.docx")
	f, err := os.OpenFile(filePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	for name, value := range parts {
		entry, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	return filePath
}

func validContentTypes() string {
	return `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="` + docxMainContentType + `"/></Types>`
}

func acceptedTestMIME(value string) bool {
	return value == officialDOCXMIME || value == "application/octet-stream"
}
