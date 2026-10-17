# LeadAtlas Production Database Backup & Disaster Recovery Specification

> **CRITICAL PRE-LAUNCH NOTICE:**
> Database backup automation and Point-In-Time Recovery (PITR) are managed at the **cloud infrastructure / database hosting tier** (e.g., AWS RDS, Supabase, Neon, or automated host-level systemd crons with `pg_dump`/WAL-G). The application codebase itself does not provide internal database snapshotting.
>
> Real customer production traffic must **NOT** be enabled until the operations team completes and verifies all prerequisites below.

---

## 1. Production Sign-Off Checklist (Mandatory Prerequisite)

- [ ] **Automated Daily Snapshot Enabled:** PostgreSQL database configured for automated daily physical or logical snapshots during off-peak hours (e.g., 03:00 UTC).
- [ ] **Retention Window Configured:** Snapshot retention policy set to a minimum of **30 calendar days**.
- [ ] **Continuous WAL Archiving / PITR:** Continuous Write-Ahead Log (WAL) archiving enabled with Point-In-Time Recovery granularity (maximum 15-minute recovery point objective).
- [ ] **Off-Site / Multi-Region Replication:** Backup archives mirrored to secondary object storage (e.g. AWS S3 / Cloudflare R2) with strict IAM bucket isolation and encryption-at-rest.
- [ ] **Documented Restore Runbook:** Step-by-step restoration commands documented and accessible to authorized on-call engineers.
- [ ] **Drill / Restore Verification Performed:** Full restoration drill executed against a staging or test database, verifying data integrity across all 20 Prisma migrations.

---

## 2. Recovery Objectives

| Metric | Target | Rationale |
| :--- | :---: | :--- |
| **RPO (Recovery Point Objective)** | **< 15 minutes** | Achieved via continuous WAL archiving; prevents wholesale lead/mission transaction loss. |
| **RTO (Recovery Time Objective)** | **< 30 minutes** | Time required to provision a target PostgreSQL instance and replay WAL stream. |

---

## 3. Recommended Automated Host / Managed Runbook

### For Managed PostgreSQL (AWS RDS / Supabase / Neon):
1. In Cloud Console, enable **Automated Backups** with `Retention Period = 30 days`.
2. Enable **Point-in-Time Recovery**.
3. Enable **Deletion Protection** to prevent accidental volume teardown.
4. Schedule weekly test restore to verify snapshot integrity.

### For Self-Hosted PostgreSQL (Bare-metal / VPS):
```bash
# Automated daily logical backup cron example (/etc/cron.daily/leadmate-pg-backup)
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/var/backups/leadmate"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="${BACKUP_DIR}/leadmate_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"
pg_dump -h localhost -U postgres -d leadmate --clean --if-exists | gzip > "${FILENAME}"
chmod 600 "${FILENAME}"

# Prune backups older than 30 days
find "${BACKUP_DIR}" -type f -name "leadmate_*.sql.gz" -mtime +30 -delete
```

---

## 4. Verification & Audit Evidence
* **Current Status in Repository:** Application-level code is ready.
* **External Deployment Status:** Pending infrastructure-level backup verification prior to production launch.
