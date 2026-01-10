.PHONY: all install dev stop frontend backend clean

all: install dev

install:
	npm run install:all

dev:
	npm run dev

stop:
	@pkill -f "next dev" 2>/dev/null || true
	@pkill -f "tsx watch" 2>/dev/null || true
	@pkill -f "node.*backend" 2>/dev/null || true
	@echo "Services stopped"

frontend:
	cd frontend && npm run dev

backend:
	cd backend && npm run dev

clean:
	rm -rf node_modules frontend/node_modules backend/node_modules
