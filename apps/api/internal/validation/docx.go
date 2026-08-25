package validation

import (
	"archive/zip"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const (
	maxDOCXEntries          = 4096
	maxDOCXExpandedBytes    = 256 * 1024 * 1024
	maxDOCXCompressionRatio = 200
	maxContentTypesBytes    = 1024 * 1024
	docxMainContentType     = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
)

var ErrInvalidDOCX = errors.New("invalid DOCX file")

type contentTypes struct {
	Overrides []struct {
		PartName    string `xml:"PartName,attr"`
		ContentType string `xml:"ContentType,attr"`
	} `xml:"Override"`
}

// DOCX validates the three independent client claims (extension, declared
// MIME, and ZIP signature) and then validates the OOXML container without
// extracting it.
func DOCX(filename, declaredMIME, filePath string, maxBytes int64, acceptsMIME func(string) bool) error {
	if !strings.EqualFold(filepath.Ext(filename), ".docx") {
		return fmt.Errorf("%w: the file extension must be .docx", ErrInvalidDOCX)
	}
	if !acceptsMIME(declaredMIME) {
		return fmt.Errorf("%w: unsupported declared MIME type", ErrInvalidDOCX)
	}

	f, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("%w: open input", ErrInvalidDOCX)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.Size() < 4 || info.Size() > maxBytes {
		return fmt.Errorf("%w: invalid input size", ErrInvalidDOCX)
	}
	var signature [4]byte
	if _, err := io.ReadFull(f, signature[:]); err != nil || string(signature[:]) != "PK\x03\x04" {
		return fmt.Errorf("%w: invalid ZIP signature", ErrInvalidDOCX)
	}

	zr, err := zip.NewReader(f, info.Size())
	if err != nil {
		return fmt.Errorf("%w: malformed OOXML archive", ErrInvalidDOCX)
	}
	if len(zr.File) == 0 || len(zr.File) > maxDOCXEntries {
		return fmt.Errorf("%w: invalid archive entry count", ErrInvalidDOCX)
	}

	entries := make(map[string]*zip.File, len(zr.File))
	var declaredExpanded uint64
	for _, entry := range zr.File {
		canonical, err := safeArchivePath(entry.Name)
		if err != nil {
			return fmt.Errorf("%w: unsafe archive path", ErrInvalidDOCX)
		}
		key := strings.ToLower(canonical)
		if _, duplicate := entries[key]; duplicate {
			return fmt.Errorf("%w: duplicate archive entry", ErrInvalidDOCX)
		}
		entries[key] = entry
		if entry.Flags&1 != 0 {
			return fmt.Errorf("%w: encrypted archive entries are not supported", ErrInvalidDOCX)
		}
		if ^uint64(0)-declaredExpanded < entry.UncompressedSize64 {
			return fmt.Errorf("%w: expanded archive is too large", ErrInvalidDOCX)
		}
		declaredExpanded += entry.UncompressedSize64
		if declaredExpanded > maxDOCXExpandedBytes {
			return fmt.Errorf("%w: expanded archive is too large", ErrInvalidDOCX)
		}
		if entry.UncompressedSize64 > 0 {
			if entry.CompressedSize64 == 0 || entry.UncompressedSize64/entry.CompressedSize64 > maxDOCXCompressionRatio {
				return fmt.Errorf("%w: suspicious compression ratio", ErrInvalidDOCX)
			}
		}
	}

	var actualExpanded int64
	for _, entry := range zr.File {
		remaining := int64(maxDOCXExpandedBytes) - actualExpanded
		if remaining < 0 {
			return fmt.Errorf("%w: expanded archive is too large", ErrInvalidDOCX)
		}
		r, err := entry.Open()
		if err != nil {
			return fmt.Errorf("%w: archive entry cannot be opened", ErrInvalidDOCX)
		}
		read, copyErr := io.Copy(io.Discard, io.LimitReader(r, remaining+1))
		closeErr := r.Close()
		actualExpanded += read
		if actualExpanded > maxDOCXExpandedBytes {
			return fmt.Errorf("%w: expanded archive is too large", ErrInvalidDOCX)
		}
		if copyErr != nil || closeErr != nil || uint64(read) != entry.UncompressedSize64 {
			return fmt.Errorf("%w: corrupt archive entry", ErrInvalidDOCX)
		}
		if read > 0 &&
			(entry.CompressedSize64 == 0 || uint64(read)/entry.CompressedSize64 > maxDOCXCompressionRatio) {
			return fmt.Errorf("%w: suspicious compression ratio", ErrInvalidDOCX)
		}
	}

	for _, required := range []string{"[content_types].xml", "_rels/.rels", "word/document.xml"} {
		if _, ok := entries[required]; !ok {
			return fmt.Errorf("%w: required OOXML part is missing", ErrInvalidDOCX)
		}
	}
	if err := validateContentTypes(entries["[content_types].xml"]); err != nil {
		return err
	}
	return nil
}

func safeArchivePath(name string) (string, error) {
	if name == "" || strings.ContainsRune(name, '\x00') {
		return "", ErrInvalidDOCX
	}
	normalized := strings.ReplaceAll(name, "\\", "/")
	if strings.HasPrefix(normalized, "/") {
		return "", ErrInvalidDOCX
	}
	clean := path.Clean(normalized)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return "", ErrInvalidDOCX
	}
	return clean, nil
}

func validateContentTypes(entry *zip.File) error {
	if entry.UncompressedSize64 > maxContentTypesBytes {
		return fmt.Errorf("%w: content types part is too large", ErrInvalidDOCX)
	}
	r, err := entry.Open()
	if err != nil {
		return fmt.Errorf("%w: content types part cannot be read", ErrInvalidDOCX)
	}
	defer r.Close()
	decoder := xml.NewDecoder(io.LimitReader(r, maxContentTypesBytes+1))
	var types contentTypes
	if err := decoder.Decode(&types); err != nil {
		return fmt.Errorf("%w: malformed content types part", ErrInvalidDOCX)
	}
	for _, override := range types.Overrides {
		if strings.EqualFold(override.PartName, "/word/document.xml") {
			if override.ContentType != docxMainContentType {
				return fmt.Errorf("%w: macro-enabled or unsupported Word document", ErrInvalidDOCX)
			}
			return nil
		}
	}
	return fmt.Errorf("%w: Word document content type is missing", ErrInvalidDOCX)
}
