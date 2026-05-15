.PHONY: help start-all build-release

help: ## Show available targets
	@echo "Dickory Docs"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\n", $$1, $$2}'

start-all: ## Start Dickory Docs Tauri dev (Vite on port 5177)
	@bash "$(CURDIR)/scripts/start-all.sh"

build-release: ## Build installable .app / .dmg (macOS, release)
	npm run tauri:build
