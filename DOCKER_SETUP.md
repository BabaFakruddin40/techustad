# TechUstad Docker Setup Guide

This directory contains Docker configurations for containerizing the TechUstad application with microservices.

## 📋 Prerequisites

- **Docker** (v20.10+): [Install Docker](https://docs.docker.com/install/)
- **Docker Compose** (v2.0+): [Install Docker Compose](https://docs.docker.com/compose/install/)
- **.env file** configured with credentials (Google OAuth, Twilio, Stripe, etc.)

## 🚀 Quick Start

### 1. **Build and Run (Development)**

```bash
cd /Users/bfakrudd/projects/techustad

# Build the image
docker-compose build

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f backend
```

The app will be available at: **https://techustad.com:3000**

### 2. **Verify Services are Running**

```bash
# Check container status
docker-compose ps

# Check health
curl -k https://techustad.com:3000/health | jq .

# View logs
docker-compose logs backend
```

### 3. **Stop Services**

```bash
docker-compose down

# Remove volumes (deletes database)
docker-compose down -v
```

---

## 🎯 Service Architecture

```
┌─────────────────────────────────────────────────────────┐
│  User Browser (https://techustad.com:3000)              │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────────────────────┐
│  Nginx Reverse Proxy (Port 443)                         │
│  - SSL/TLS Termination                                  │
│  - Rate Limiting                                        │
│  - Security Headers                                     │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────────────────────┐
│  Node.js/Express Backend (Port 3000)                    │
│  - API Routes                                           │
│  - Authentication (OAuth, Email, Phone OTP)             │
│  - Payments (Stripe)                                    │
│  - Support Chat                                         │
└──────────────────┬──────────────────────────────────────┘
                   │
         ┌─────────┼─────────┬──────────┐
         ↓         ↓         ↓          ↓
    ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐
    │ SQLite │ │ Redis  │ │Twilio  │ │  Stripe  │
    │        │ │ Cache  │ │  SMS   │ │ Payments │
    └────────┘ └────────┘ └────────┘ └──────────┘
```

---

## 📦 Available Services

### **Core Services (Always Running)**

| Service | Port | Purpose |
|---------|------|---------|
| **backend** | 3000 | Node.js API & Frontend |
| **db-init** | — | Database initialization |

### **Optional Services**

| Service | Port | Purpose | Profile |
|---------|------|---------|---------|
| **nginx** | 80, 443 | Reverse Proxy | `production` |
| **redis** | 6379 | Session Cache | `cache` |
| **prometheus** | 9090 | Metrics & Monitoring | `monitoring` |

---

## 🔧 Usage Examples

### **Start with All Services (Production)**

```bash
docker-compose --profile production --profile cache --profile monitoring up -d
```

### **Start with Cache (Session Store)**

```bash
docker-compose --profile cache up -d
```

### **Start with Monitoring**

```bash
docker-compose --profile monitoring up -d
# Access Prometheus at http://localhost:9090
```

### **View Real-time Logs**

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend

# Last 50 lines, follow output
docker-compose logs --tail=50 -f backend
```

### **Execute Commands in Container**

```bash
# Access backend shell
docker-compose exec backend sh

# Check database
docker-compose exec backend sqlite3 /app/data/techustad.db ".tables"

# List users
docker-compose exec backend sqlite3 /app/data/techustad.db "SELECT id, email FROM users;"
```

---

## 🔐 Environment Variables

Create or verify your `.env` file:

```env
# App Configuration
APP_URL=https://techustad.com:3000
NODE_ENV=production
PORT=3000

# Security
JWT_SECRET=your-secure-jwt-secret
SESSION_SECRET=your-secure-session-secret

# OAuth Providers
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret

# Twilio (Phone OTP)
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# Stripe (Payments)
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxx
```

---

## 📊 Monitoring & Logging

### **View Container Health**

```bash
docker-compose ps

# Output:
# NAME                COMMAND             STATUS              PORTS
# techustad-backend   node server.js      Up (healthy)        0.0.0.0:3000->3000/tcp
```

### **Check Application Logs**

```bash
# Real-time logs
docker-compose logs -f backend

# Grep for errors
docker-compose logs backend | grep -i error

# Last 100 lines
docker-compose logs --tail=100 backend
```

### **Prometheus Metrics** (if monitoring profile enabled)

```
Access: http://localhost:9090
```

---

## 🐛 Troubleshooting

### **Port Already in Use**

```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Or map to different port in docker-compose.yml:
# ports:
#   - "3001:3000"
```

### **Database Not Persisting**

```bash
# Check volumes
docker volume ls | grep techustad

# Inspect volume
docker volume inspect techustad_techustad-data

# Check if data directory exists
docker-compose exec backend ls -la /app/data/
```

### **SSL/TLS Errors**

Ensure certificates exist:

```bash
ls -la /Users/bfakrudd/projects/techustad/src/{cert.pem,key.pem}
```

### **Container Won't Start**

```bash
# Check logs
docker-compose logs backend

# Validate docker-compose.yml
docker-compose config

# Rebuild image
docker-compose build --no-cache backend
```

---

## 🚢 Deploying to Production

### **1. Use Production Profile**

```bash
docker-compose --profile production up -d
```

### **2. Update Certificates**

Place real SSL certificates in `./certs/`:

```bash
cp /path/to/real/cert.pem ./certs/
cp /path/to/real/key.pem ./certs/
```

### **3. Set Secure Environment Variables**

```bash
# Update .env with production values
export STRIPE_SECRET_KEY=sk_live_xxx
export JWT_SECRET=generate-strong-random-string
export SESSION_SECRET=generate-strong-random-string
```

### **4. Enable Health Checks**

The backend service includes a healthcheck. Monitor with:

```bash
watch docker-compose ps
```

---

## 📚 Common Commands Reference

```bash
# Build images
docker-compose build

# Start services (detached)
docker-compose up -d

# Stop services
docker-compose down

# Remove volumes (WARNING: deletes data)
docker-compose down -v

# View status
docker-compose ps

# View logs
docker-compose logs -f [service-name]

# Execute command
docker-compose exec [service] [command]

# Pull latest images
docker-compose pull

# Recreate containers
docker-compose up -d --force-recreate

# Scale service
docker-compose up -d --scale backend=3
```

---

## 🔍 Useful Docker Tips

### **View Image Details**

```bash
docker images | grep techustad
```

### **Inspect Container**

```bash
docker inspect techustad-backend
```

### **Clean Up**

```bash
# Remove unused images
docker image prune

# Remove unused volumes
docker volume prune

# Remove everything (WARNING!)
docker system prune -a --volumes
```

---

## 📖 Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Reference](https://docs.docker.com/compose/compose-file/)
- [Best Practices for Node.js in Docker](https://nodejs.org/en/docs/guides/nodejs-docker-webapp/)
- [Nginx Docker Best Practices](https://docs.nginx.com/nginx/admin-guide/installing-nginx/installing-nginx-docker/)

---

## ✅ Verification Checklist

Before deployment, verify:

- [ ] `.env` file has all required variables
- [ ] SSL certificates are in place (`cert.pem`, `key.pem`)
- [ ] Docker and Docker Compose are installed
- [ ] Port 3000 is available (or update docker-compose.yml)
- [ ] Database directory `/data` has read/write permissions
- [ ] Application starts without errors: `docker-compose up -d && docker-compose logs backend`

---

## 🤝 Support

For issues or questions, check the main README.md in the project root.
