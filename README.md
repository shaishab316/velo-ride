<div align="center">
  
<img width="1920" height="960" alt="Velo-Ride Banner" src="https://github.com/user-attachments/assets/203079b0-d2c4-423c-9623-a8db93353e97" />

**Real-Time Ride Sharing Platform**

[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com)
[![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://socket.io)

*From ride request to driver match in milliseconds — built for scale.*

</div>

---

## 🚀 Overview

**Velo-Ride** is a production-grade, real-time ride-sharing backend platform — think Uber architecture, built from scratch. It handles live driver matching using geohash-based proximity detection, real-time ride tracking via WebSockets, and role-based access for both riders and drivers.


---

## ⚙️ Architecture

```
┌─────────────┐     REST API      ┌──────────────────────┐
│   Rider App │ ────────────────► │                      │
└─────────────┘                   │    Express Server    │
                                  │    (TypeScript)      │
┌─────────────┐     REST API      │                      │
│  Driver App │ ────────────────► │  ┌────────────────┐  │
└─────────────┘                   │  │  Route Layer   │  │
       │                          │  │  Controller    │  │
       │     WebSocket            │  │  Service       │  │
       └──────────────────────────►  │  Repository    │  │
              (live tracking)     │  └────────────────┘  │
                                  └──────────┬───────────┘
                                             │
                    ┌────────────────────────┼──────────────────┐
                    │                        │                  │
              ┌─────▼──────┐         ┌───────▼───────┐   ┌──────▼──────┐
              │ PostgreSQL │         │    Redis      │   │  Socket.IO  │
              │  (Prisma)  │         │  Driver Pool  │   │  Real-time  │
              └────────────┘         └───────────────┘   └─────────────┘
```


---

## 🧠 How Driver Matching Works

Most ride apps do a full database scan for nearby drivers. We don't.

```
1. Driver goes online
   └── Location stored in Redis with TTL (auto-removed if no heartbeat)

2. Rider requests ride
   └── Rider location → converted to Geohash

3. Geohash prefix matching in Redis
   └── O(1) lookup — finds candidates in same geographic cell

4. Haversine formula on candidates only
   └── Exact distance calculation on ~20 drivers, not 10,000

5. Closest available driver gets the request
   └── WebSocket push — real-time notification
```


## ✨ Features

**Core**
- 🚗 Real-time ride request and driver matching
- 📍 Geohash + Haversine nearby driver detection
- 🔴 Live ride tracking via WebSockets
- 💓 Driver heartbeat system — auto-removes inactive drivers from pool
- 🔐 Role-based authentication — Rider / Driver / Admin

**Technical**
- ⚡ Redis-backed driver availability pool — zero DB queries for matching
- 🔒 JWT access + refresh token flow
- 🛡️ Zod request validation on all endpoints
- 🐳 Fully containerized with Docker Compose
- 🚀 GitHub Actions CI/CD pipeline
- 📊 Winston structured logging



## 🏗️ Project Structure

```
src/
├── modules/
│   ├── auth/
│   │   ├── Auth.validation.ts   # Zod schemas
│   │   ├── Auth.interface.ts    # TypeScript interfaces
│   │   ├── Auth.service.ts      # Business logic
│   │   ├── Auth.controller.ts   # Request handlers
│   │   └── Auth.route.ts        # Express routes
│   ├── ride/
│   ├── driver/
│   ├── rider/
│   └── socket/                  # Socket.IO event handlers
├── middlewares/
│   ├── catchAsync.ts            # Async error wrapper
│   └── purifyRequest.ts         # Zod validation middleware
├── utils/
│   ├── jwt.ts
│   ├── otp.ts
│   ├── crypto.ts
│   └── logger.ts
├── db/                          # Prisma client
└── config/
```

> Every module follows a strict 5-layer pattern: `validation → interface → service → controller → route`

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js + TypeScript |
| **Framework** | Express.js |
| **Database** | PostgreSQL + Prisma ORM |
| **Cache / Driver Pool** | Redis |
| **Real-time** | Socket.IO |
| **Auth** | JWT (access + refresh tokens) |
| **Validation** | Zod |
| **Logging** | Winston |
| **Containerization** | Docker + Docker Compose |
| **CI/CD** | GitHub Actions |
| **Hosting** | VPS |




---

## 🚦 API Endpoints

### Auth
```
POST   /api/v1/auth/register
GET    /api/v1/auth/verify-email
POST   /api/v1/auth/login
POST   /api/v1/auth/forgot-password
POST   /api/v1/auth/reset-password-otp-verify
POST   /api/v1/auth/reset-password
```

### Rides
```
POST   /api/v1/rides/request         # Rider requests a ride
PATCH  /api/v1/rides/:id/accept      # Driver accepts
PATCH  /api/v1/rides/:id/complete    # Mark ride complete
GET    /api/v1/rides/:id             # Get ride details
```

### Drivers
```
POST   /api/v1/drivers/go-online     # Enter Redis driver pool
POST   /api/v1/drivers/go-offline    # Leave driver pool
PATCH  /api/v1/drivers/location      # Update live location
```

---

## 🔌 WebSocket Events

```typescript
// Client → Server
socket.emit('driver:location', { lat, lng })    // Live location update
socket.emit('driver:ping', {})                  // Heartbeat

// Server → Client
socket.emit('ride:matched', { rideId, driver }) // Ride found
socket.emit('ride:status', { status })          // Ride updates
socket.emit('driver:arrived', {})               // Driver at pickup
```


---

## 🐳 Quick Start

```bash
# Clone the repo
git clone https://github.com/shaishab316/velo-ride.git
cd velo-ride

# Generate environment variables
npm run seed-env

# Start with Docker
docker compose up -d

# Run migrations
npx prisma migrate dev

# Start development server
npm run dev
```

---

## 👤 Author

**Shaishab Chandra Shil**
Self-taught Backend Developer · Dhaka, Bangladesh

[![GitHub](https://img.shields.io/badge/GitHub-shaishab316-181717?style=flat-square&logo=github)](https://github.com/shaishab316)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-shaishab316-0A66C2?style=flat-square&logo=linkedin)](https://linkedin.com/in/shaishab316)

---

<div align="center">

*Built with persistence, raw documentation, and zero tutorials.* 🔥

</div>
