.PHONY: all install dev stop frontend backend circom clean clean-circom circom-status

# Default: run without circom (uses mock proofs)
all: install dev

install:
	pnpm run install:all

dev:
	pnpm run dev

stop:
	@pkill -f "next dev" 2>/dev/null || true
	@pkill -f "tsx watch" 2>/dev/null || true
	@pkill -f "node.*backend" 2>/dev/null || true
	@echo "Services stopped"

frontend:
	cd frontend && pnpm run dev

backend:
	cd backend && pnpm run dev

# Optional: Build real ZK circuits (requires circom installed)
# After running this, the app will automatically use real proofs
circom:
	@echo "Building ZK circuits (requires circom to be installed)..."
	@echo "Install circom: brew install circom (macOS)"
	@echo ""
	cd circuits && pnpm install && pnpm run build

clean:
	rm -rf node_modules frontend/node_modules backend/node_modules
	rm -rf circuits/node_modules circuits/build
	rm -rf frontend/public/zk

clean-circom:
	rm -rf circuits/build
	rm -rf frontend/public/zk
	@echo "Circom artifacts cleaned. Run 'make circom' to rebuild."

circom-status:
	@if [ -f frontend/public/zk/jwt_domain_verifier.wasm ] && \
	    [ -f frontend/public/zk/jwt_domain_verifier.zkey ] && \
	    [ -f frontend/public/zk/verification_key.json ]; then \
		echo "Circom: ENABLED (real proofs)"; \
		ls -lh frontend/public/zk/; \
	else \
		echo "Circom: DISABLED (demo mode)"; \
		echo "Run 'make circom' to enable real proofs."; \
	fi
