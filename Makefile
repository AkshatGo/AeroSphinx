# AeroSphinx - developer entry points.
#
# Every target is safe to run from a clean checkout. Raw data under
# data/cpcb, data/aod and data/merra2 is never modified.

PYTHON ?= .venv/bin/python
PIP    ?= .venv/bin/python -m pip
ROOT   := $(shell pwd)

.DEFAULT_GOAL := help
.PHONY: help install install-dev test test-unit test-integration audit \
        build-track-a lint clean

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

install: ## Install the package
	$(PIP) install -e .

install-dev: ## Install the package with test dependencies
	$(PIP) install -e ".[dev]"

test: ## Run the full test suite
	$(PYTHON) -m pytest tests/ -v

test-unit: ## Run unit tests only
	$(PYTHON) -m pytest tests/unit -v

test-integration: ## Run integration tests only
	$(PYTHON) -m pytest tests/integration -v

audit: ## Regenerate the Phase 0 baseline audit artefacts
	$(PYTHON) scripts/audit_repository.py
	$(PYTHON) scripts/audit_data.py

build-track-a: ## Build the Track A daily dataset and manifest
	$(PYTHON) scripts/build_track_a_dataset.py

lint: ## Byte-compile every module as a syntax check
	$(PYTHON) -m compileall -q src scripts tests

clean: ## Remove build and cache artefacts
	rm -rf build dist *.egg-info .pytest_cache
	find . -name '__pycache__' -type d -prune -exec rm -rf {} +
	find . -name '*.pyc' -delete
