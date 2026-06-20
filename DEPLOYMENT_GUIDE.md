# TechUstad Deployment Guide

Complete guide for deploying TechUstad as containerized microservices using Docker Compose and Kubernetes.

---

## 📋 Table of Contents

1. [Docker Compose Deployment](#docker-compose-deployment)
2. [Kubernetes Deployment](#kubernetes-deployment)
3. [Production Checklist](#production-checklist)
4. [Scaling & Performance](#scaling--performance)
5. [Monitoring & Logging](#monitoring--logging)

---

## 🐳 Docker Compose Deployment

### **Quick Start**

```bash
cd /Users/bfakrudd/projects/techustad

# 1. Build Docker image
docker-compose build

# 2. Start services (detached mode)
docker-compose up -d

# 3. Check status
docker-compose ps

# 4. View logs
docker-compose logs -f backend
```

### **Verify Deployment**

```bash
# Check health endpoint
curl -k https://techustad.com:3000/health | jq .

# Expected response:
# {
#   "status": "ok",
#   "service": "techustad-web",
#   "features": {
#     "google_auth": true,
#     "github_auth": true,
#     "twilio": true,
#     "stripe": false
#   }
# }
```

### **Common Commands**

```bash
# Stop all services
docker-compose down

# Restart specific service
docker-compose restart backend

# View logs with filtering
docker-compose logs backend | grep -i error

# Access backend shell
docker-compose exec backend sh

# Check database
docker-compose exec backend sqlite3 /app/data/techustad.db ".tables"

# Scale backend to 3 instances (with load balancer)
docker-compose up -d --scale backend=3
```

---

## ☸️ Kubernetes Deployment

### **Prerequisites**

```bash
# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/darwin/amd64/kubectl"
chmod +x kubectl
sudo mv kubectl /usr/local/bin/

# Install minikube (for local development) or connect to existing cluster
brew install minikube  # macOS
minikube start --cpus=4 --memory=4096
```

### **Build and Push Image to Registry**

```bash
# Build image
docker build -t techustad-backend:latest .

# Tag for Docker Hub (replace YOUR_REGISTRY)
docker tag techustad-backend:latest YOUR_REGISTRY/techustad-backend:latest

# Push to registry
docker push YOUR_REGISTRY/techustad-backend:latest

# For minikube (load image directly)
minikube image load techustad-backend:latest
```

### **Deploy to Kubernetes**

```bash
# 1. Create namespace and deploy manifests
kubectl apply -f k8s-deployment.yaml

# 2. Verify resources created
kubectl get all -n techustad

# 3. Check pod status
kubectl get pods -n techustad -w

# 4. View deployment logs
kubectl logs -n techustad deployment/techustad-backend --tail=50

# 5. Port forward to test locally
kubectl port-forward -n techustad svc/techustad-backend 3000:443
```

### **Update Secrets**

```bash
# Create TLS secret for certificates
kubectl create secret tls techustad-tls \
  --cert=./src/cert.pem \
  --key=./src/key.pem \
  -n techustad

# Update other secrets
kubectl create secret generic techustad-secrets \
  --from-env-file=.env \
  -n techustad \
  --dry-run=client \
  -o yaml | kubectl apply -f -
```

### **Scaling**

```bash
# Scale to specific number of replicas
kubectl scale deployment techustad-backend --replicas=5 -n techustad

# View HPA status
kubectl get hpa -n techustad -w

# Check HPA events
kubectl describe hpa techustad-backend-hpa -n techustad
```

### **Monitoring Deployments**

```bash
# Watch deployment
kubectl rollout status deployment/techustad-backend -n techustad

# View deployment history
kubectl rollout history deployment/techustad-backend -n techustad

# Rollback to previous version
kubectl rollout undo deployment/techustad-backend -n techustad

# Get events
kubectl get events -n techustad --sort-by='.lastTimestamp'
```

### **Useful kubectl Commands**

```bash
# Get all resources in namespace
kubectl get all -n techustad

# Describe pod for debugging
kubectl describe pod <pod-name> -n techustad

# Execute command in pod
kubectl exec -it <pod-name> -n techustad -- /bin/sh

# Forward port for local testing
kubectl port-forward svc/techustad-backend 3000:443 -n techustad

# Stream logs from all pods
kubectl logs -n techustad deployment/techustad-backend -f

# Get resource usage
kubectl top nodes
kubectl top pods -n techustad

# Delete all resources
kubectl delete namespace techustad
```

---

## ✅ Production Checklist

### **Before Deploying**

- [ ] Environment variables configured (`.env` file)
- [ ] SSL/TLS certificates in place
- [ ] Database backup strategy defined
- [ ] Monitoring and logging configured
- [ ] Backup and restore tested
- [ ] Rate limiting configured
- [ ] Security headers configured
- [ ] OAuth credentials verified
- [ ] Twilio account funded (if using SMS)
- [ ] Stripe account in production mode

### **Docker Compose Production**

```bash
# 1. Use production profile
docker-compose --profile production up -d

# 2. Setup log rotation
docker run --log-driver local \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  techustad-backend:latest

# 3. Setup backups
docker run --volumes-from techustad-backend \
  -v /backups:/backup \
  alpine:latest \
  tar czf /backup/techustad-$(date +%Y%m%d).tar.gz /app/data

# 4. Monitor with Prometheus
docker-compose --profile monitoring up -d
# Access: http://localhost:9090
```

### **Kubernetes Production**

```bash
# 1. Install ingress controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.0.0/deploy/static/provider/baremetal/deploy.yaml

# 2. Setup cert-manager for automatic TLS
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# 3. Deploy with proper resources
kubectl apply -f k8s-deployment.yaml

# 4. Setup monitoring with Prometheus
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus prometheus-community/kube-prometheus-stack -n techustad

# 5. Setup logging with ELK stack
helm repo add elastic https://helm.elastic.co
helm install elasticsearch elastic/elasticsearch -n techustad
helm install kibana elastic/kibana -n techustad
```

---

## 📈 Scaling & Performance

### **Auto-Scaling**

**Docker Compose:**
```bash
# Scale backend to 5 instances
docker-compose up -d --scale backend=5
```

**Kubernetes:**
- HPA automatically scales between 3-10 replicas based on CPU/Memory
- View scaling activity: `kubectl get hpa -n techustad -w`

### **Performance Tuning**

```bash
# Monitor resource usage
docker stats
kubectl top pods -n techustad

# Adjust resource limits in docker-compose.yml or k8s-deployment.yaml
# Scale up if approaching limits:
# - CPU: 70% utilization target
# - Memory: 80% utilization target
```

### **Database Optimization**

```bash
# Backup database
docker-compose exec backend sqlite3 /app/data/techustad.db ".backup /app/data/backup.db"

# Analyze and optimize
docker-compose exec backend sqlite3 /app/data/techustad.db "VACUUM; ANALYZE;"

# Check database size
docker-compose exec backend du -sh /app/data/techustad.db
```

---

## 📊 Monitoring & Logging

### **Docker Compose Monitoring**

```bash
# View real-time resource usage
docker stats

# Check container health
docker-compose ps

# View logs
docker-compose logs backend -f

# Export logs
docker-compose logs backend > techustad-logs.txt
```

### **Kubernetes Monitoring**

```bash
# View pod metrics
kubectl top pods -n techustad

# View node metrics
kubectl top nodes

# Check pod events
kubectl get events -n techustad --sort-by='.lastTimestamp'

# View logs from specific pod
kubectl logs -n techustad <pod-name> -f

# View logs from all pods in deployment
kubectl logs -n techustad deployment/techustad-backend -f

# Get previous logs (if pod crashed)
kubectl logs -n techustad <pod-name> --previous
```

### **Prometheus Metrics** (if monitoring enabled)

```bash
# Access Prometheus dashboard
# Docker: http://localhost:9090
# Kubernetes: kubectl port-forward -n techustad svc/prometheus 9090:9090

# Useful queries:
# - Container memory usage: container_memory_usage_bytes
# - Container CPU usage: rate(container_cpu_usage_seconds_total[5m])
# - HTTP request rate: rate(http_requests_total[1m])
```

---

## 🔧 Troubleshooting

### **Container Won't Start**

```bash
# Docker Compose
docker-compose logs backend
docker-compose config | grep -A20 backend

# Kubernetes
kubectl describe pod <pod-name> -n techustad
kubectl logs <pod-name> -n techustad --previous
```

### **Database Not Persisting**

```bash
# Docker Compose
docker volume ls | grep techustad
docker volume inspect techustad_techustad-data

# Kubernetes
kubectl get pvc -n techustad
kubectl describe pvc techustad-data-pvc -n techustad
```

### **High Memory Usage**

```bash
# Identify memory-heavy pods
kubectl top pods -n techustad --sort-by=memory

# Increase memory limits in k8s-deployment.yaml
# limits:
#   memory: "1Gi"
```

### **Slow Performance**

```bash
# Check node resources
kubectl top nodes

# Check pod CPU
kubectl top pods -n techustad

# Optimize database
docker-compose exec backend sqlite3 /app/data/techustad.db "EXPLAIN QUERY PLAN SELECT * FROM users;"
```

---

## 🔄 Backup & Restore

### **Backup Database**

```bash
# Docker Compose
docker-compose exec backend sqlite3 /app/data/techustad.db ".backup /app/data/techustad-backup.db"
docker cp techustad-backend:/app/data/techustad-backup.db ./backups/

# Kubernetes
kubectl exec -n techustad <pod-name> -- sqlite3 /app/data/techustad.db ".backup /app/data/techustad-backup.db"
kubectl cp techustad/<pod-name>:/app/data/techustad-backup.db ./backups/
```

### **Restore Database**

```bash
# Docker Compose
docker cp ./backups/techustad-backup.db techustad-backend:/app/data/
docker-compose exec backend sqlite3 /app/data/techustad.db ".restore /app/data/techustad-backup.db"

# Kubernetes
kubectl cp ./backups/techustad-backup.db techustad/<pod-name>:/app/data/
kubectl exec -n techustad <pod-name> -- sqlite3 /app/data/techustad.db ".restore /app/data/techustad-backup.db"
```

---

## 📚 Additional Resources

- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Kubernetes Best Practices](https://kubernetes.io/docs/concepts/configuration/overview/)
- [Production Checklist](https://12factor.net/)
- [Security Best Practices](https://kubernetes.io/docs/concepts/security/)

---

## 🎯 Next Steps

1. **Monitor**: Set up Prometheus and Grafana for metrics
2. **Logging**: Configure centralized logging (ELK, Loki)
3. **CI/CD**: Automate deployments with GitHub Actions or GitLab CI
4. **Backup**: Implement automated daily backups
5. **Disaster Recovery**: Test recovery procedures
6. **Security**: Run security scans (Trivy, Snyk)
7. **Load Testing**: Test with realistic load (k6, JMeter)

---

For additional help, refer to [DOCKER_SETUP.md](./DOCKER_SETUP.md) for Docker-specific documentation.
