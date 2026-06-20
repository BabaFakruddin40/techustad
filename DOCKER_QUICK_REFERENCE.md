# 🚀 TechUstad Docker Quick Reference

## Start Services

```bash
# Basic (backend + database)
docker-compose up -d

# With caching
docker-compose --profile cache up -d

# With monitoring
docker-compose --profile monitoring up -d

# Full production
docker-compose --profile production --profile cache --profile monitoring up -d
```

## Check Status

```bash
# List containers
docker-compose ps

# View health endpoint
curl -k https://techustad.com:3000/health

# Follow logs
docker-compose logs -f backend

# Check resource usage
docker stats
```

## Stop & Cleanup

```bash
# Stop (keep data)
docker-compose down

# Stop and delete everything
docker-compose down -v

# Remove unused images
docker image prune
```

## Database

```bash
# Access database shell
docker-compose exec backend sh

# List users
docker-compose exec backend sqlite3 /app/data/techustad.db "SELECT id, email FROM users;"

# Backup
docker-compose exec backend sqlite3 /app/data/techustad.db ".backup /app/data/backup.db"

# Optimize
docker-compose exec backend sqlite3 /app/data/techustad.db "VACUUM; ANALYZE;"
```

## Kubernetes

```bash
# Deploy
kubectl apply -f k8s-deployment.yaml

# Check status
kubectl get pods -n techustad

# View logs
kubectl logs -n techustad deployment/techustad-backend -f

# Port forward
kubectl port-forward -n techustad svc/techustad-backend 3000:443

# Scale
kubectl scale deployment techustad-backend --replicas=5 -n techustad
```

## Troubleshooting

```bash
# Check logs
docker-compose logs backend

# Validate config
docker-compose config

# Rebuild image
docker-compose build --no-cache backend

# Access container shell
docker-compose exec backend sh

# Check container health
docker inspect techustad-backend | grep -A 5 Health
```

## Monitoring

```bash
# Prometheus (if --profile monitoring enabled)
# Access: http://localhost:9090

# Docker stats
docker stats

# Kubernetes metrics
kubectl top pods -n techustad
kubectl top nodes
```

## Services

| Service | Port | URL |
|---------|------|-----|
| Backend | 3000 | https://techustad.com:3000 |
| Prometheus | 9090 | http://localhost:9090 |
| Redis | 6379 | redis://localhost:6379 |
| Nginx | 443 | https://techustad.com |

## Documentation

- **[CONTAINERIZATION_SUMMARY.md](./CONTAINERIZATION_SUMMARY.md)** - Overview & quick start
- **[DOCKER_SETUP.md](./DOCKER_SETUP.md)** - Docker Compose detailed guide
- **[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)** - Production deployment guide

## Quick Tips

```bash
# Kill port if in use
lsof -ti:3000 | xargs kill -9

# Get container IP
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' techustad-backend

# Clean everything
docker system prune -a --volumes

# View environment variables in container
docker-compose exec backend env | grep -i api

# Test SSL certificate
curl -kv https://techustad.com:3000/health
```

## Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| Port 3000 in use | `lsof -ti:3000 \| xargs kill -9` |
| Database error | `docker-compose down -v && docker-compose up -d` |
| Slow startup | Check logs: `docker-compose logs backend` |
| SSL certificate warning | Normal for self-signed certs, proceed anyway |
| 429 Rate limit error | Increased OTP limit to 50/hour in server.js |

---

**For detailed guides, see [CONTAINERIZATION_SUMMARY.md](./CONTAINERIZATION_SUMMARY.md)**
