---
name: pdf-processing
description: Extracts text and tables from PDF files, fills PDF forms and merges documents. Use when working with PDF files or when the user mentions PDFs, forms or document extraction.
license: Apache-2.0
compatibility: Requires Python 3.10+ and the pdfplumber package
metadata:
  author: example-org
  version: "1.0"
allowed-tools: Bash(python:*) Read
---

# PDF processing

## Quick start

Extract text with the bundled script:

```bash
python scripts/extract.py input.pdf > output.txt
```

## Forms

Fill forms with the template in [assets/form-template.json](assets/form-template.json).
See [the reference guide](references/REFERENCE.md) for every option.

## Edge cases

- Scanned PDFs have no text layer; tell the user OCR is needed.
- Encrypted PDFs need the password before extraction.
