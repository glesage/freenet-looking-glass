# Looking Glass — build & publish orchestration.
# No contract or delegate crates: the UI is the whole app, published as the
# state of the generic web container contract via `fdev website`.

WEB_DIR := web
DIST := $(WEB_DIR)/dist
SITE_KEY := freenet-looking-glass
NODE_HOST ?= 127.0.0.1:7509

.PHONY: build dev test publish update liveness clean

build:
	cd $(WEB_DIR) && npm install && npm run build

dev:
	cd $(WEB_DIR) && npm run dev

# Live-node gate: unit tests plus looking-glass e2e against a required local node.
test:
	@curl -fsS --max-time 3 http://$(NODE_HOST)/ >/dev/null 2>&1 || { \
	  echo "ERROR: no Freenet node at http://$(NODE_HOST)/"; \
	  echo "Looking Glass reads state from a real node — start one, then re-run."; \
	  echo "Different port? make test NODE_HOST=127.0.0.1:7510"; \
	  exit 1; }
	cd $(WEB_DIR) && npm install && npm run test:unit && \
	  FREENET_NODE_HOST=$(NODE_HOST) npx playwright test e2e/looking-glass.spec.ts

# First publish. Run `fdev website init $(SITE_KEY)` ONCE beforehand and
# BACK UP the signing key (macOS:
# ~/Library/Application Support/freenet/website-keys/$(SITE_KEY).toml).
publish: build
	fdev website publish $(DIST) --key $(SITE_KEY)

# Every later release — same command shape, same permanent URL.
update: build
	fdev website update $(DIST) --key $(SITE_KEY)

# Post-publish gate. Requires the gateway URL of the PUBLISHED app:
#   FREENET_BASE_URL=http://127.0.0.1:7509/v1/contract/web/<id>/ make liveness
liveness:
ifndef FREENET_BASE_URL
	$(error FREENET_BASE_URL is not set — the liveness test runs against the \
published app. Publish first (make publish), then: \
FREENET_BASE_URL=http://127.0.0.1:7509/v1/contract/web/<id>/ make liveness)
endif
	cd $(WEB_DIR) && npx playwright test e2e/production-liveness.spec.ts

clean:
	rm -rf $(DIST) $(WEB_DIR)/node_modules $(WEB_DIR)/test-results
