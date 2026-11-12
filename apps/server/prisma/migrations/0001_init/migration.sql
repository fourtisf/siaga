-- PostGIS untuk pencarian radius. Di produksi, buat ekstensi sebagai superuser sebelum
-- `prisma migrate deploy` bila pengguna aplikasi bukan superuser (lihat docs/DEPLOY.md).
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('pending', 'approved', 'rejected', 'duplicate');

-- CreateEnum
CREATE TYPE "AlertChannel" AS ENUM ('webpush', 'telegram', 'whatsapp');

-- CreateTable
CREATE TABLE "Earthquake" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "time" TIMESTAMPTZ(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "geom" geography(Point, 4326),
    "magnitude" DOUBLE PRECISION NOT NULL,
    "depthKm" DOUBLE PRECISION NOT NULL,
    "place" TEXT NOT NULL,
    "felt" TEXT,
    "potential" TEXT,
    "tsunami" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Earthquake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hotspot" (
    "id" BIGSERIAL NOT NULL,
    "satellite" TEXT NOT NULL,
    "time" TIMESTAMPTZ(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "geom" geography(Point, 4326),
    "frp" DOUBLE PRECISION NOT NULL,
    "confidence" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hotspot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeatherObservation" (
    "id" BIGSERIAL NOT NULL,
    "cell" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "geom" geography(Point, 4326),
    "modelTime" TIMESTAMPTZ(3) NOT NULL,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,
    "precipNow" DOUBLE PRECISION NOT NULL,
    "past24" DOUBLE PRECISION NOT NULL,
    "next24" DOUBLE PRECISION NOT NULL,
    "temp" DOUBLE PRECISION,
    "wind" DOUBLE PRECISION,
    "level" INTEGER NOT NULL,

    CONSTRAINT "WeatherObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AirObservation" (
    "id" BIGSERIAL NOT NULL,
    "cell" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "geom" geography(Point, 4326),
    "modelTime" TIMESTAMPTZ(3) NOT NULL,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,
    "aqi" INTEGER NOT NULL,
    "pm25" DOUBLE PRECISION,
    "pm10" DOUBLE PRECISION,
    "level" INTEGER NOT NULL,

    CONSTRAINT "AirObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityReport" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "hazard" TEXT NOT NULL,
    "time" TIMESTAMPTZ(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "geom" geography(Point, 4326),
    "text" TEXT NOT NULL,
    "depthCm" INTEGER,
    "imageUrl" TEXT,
    "city" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CommunityReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Volcano" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "geom" geography(Point, 4326),
    "region" TEXT,
    "alert" INTEGER,
    "erupting" BOOLEAN NOT NULL DEFAULT false,
    "satellite" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "alertChangedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Volcano_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "VolcanoChange" (
    "id" BIGSERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "fromAlert" INTEGER,
    "toAlert" INTEGER,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VolcanoChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedRun" (
    "id" BIGSERIAL NOT NULL,
    "feed" TEXT NOT NULL,
    "source" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "count" INTEGER,
    "error" TEXT,

    CONSTRAINT "FeedRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Place" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "geom" geography(Point, 4326),
    "position" INTEGER NOT NULL DEFAULT 0,
    "lastLevel" INTEGER,
    "lastAssessedAt" TIMESTAMPTZ(3),
    "notifiedLevel" INTEGER,
    "lastNotifiedAt" TIMESTAMPTZ(3),
    "downSince" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Place_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "geom" geography(Point, 4326),
    "photoKey" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'pending',
    "duplicateOfId" TEXT,
    "ipHash" TEXT,
    "moderatedAt" TIMESTAMPTZ(3),
    "moderatedBy" TEXT,
    "moderationNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertSubscription" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "channel" "AlertChannel" NOT NULL,
    "key" TEXT NOT NULL,
    "payload" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertLog" (
    "id" BIGSERIAL NOT NULL,
    "placeId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "channel" "AlertChannel" NOT NULL,
    "fromLevel" INTEGER,
    "toLevel" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Earthquake_time_idx" ON "Earthquake"("time");

-- CreateIndex
CREATE INDEX "Earthquake_geom_idx" ON "Earthquake" USING GIST ("geom");

-- CreateIndex
CREATE INDEX "Hotspot_time_idx" ON "Hotspot"("time");

-- CreateIndex
CREATE INDEX "Hotspot_geom_idx" ON "Hotspot" USING GIST ("geom");

-- CreateIndex
CREATE UNIQUE INDEX "Hotspot_satellite_time_lat_lon_key" ON "Hotspot"("satellite", "time", "lat", "lon");

-- CreateIndex
CREATE INDEX "WeatherObservation_cell_fetchedAt_idx" ON "WeatherObservation"("cell", "fetchedAt");

-- CreateIndex
CREATE INDEX "WeatherObservation_fetchedAt_idx" ON "WeatherObservation"("fetchedAt");

-- CreateIndex
CREATE INDEX "AirObservation_cell_fetchedAt_idx" ON "AirObservation"("cell", "fetchedAt");

-- CreateIndex
CREATE INDEX "AirObservation_fetchedAt_idx" ON "AirObservation"("fetchedAt");

-- CreateIndex
CREATE INDEX "CommunityReport_time_idx" ON "CommunityReport"("time");

-- CreateIndex
CREATE INDEX "CommunityReport_geom_idx" ON "CommunityReport" USING GIST ("geom");

-- CreateIndex
CREATE INDEX "VolcanoChange_code_at_idx" ON "VolcanoChange"("code", "at");

-- CreateIndex
CREATE INDEX "FeedRun_feed_startedAt_idx" ON "FeedRun"("feed", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Device_tokenHash_key" ON "Device"("tokenHash");

-- CreateIndex
CREATE INDEX "Place_deviceId_idx" ON "Place"("deviceId");

-- CreateIndex
CREATE INDEX "Place_geom_idx" ON "Place" USING GIST ("geom");

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_deviceId_createdAt_idx" ON "Report"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "Report_geom_idx" ON "Report" USING GIST ("geom");

-- CreateIndex
CREATE INDEX "AlertSubscription_deviceId_idx" ON "AlertSubscription"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertSubscription_channel_key_key" ON "AlertSubscription"("channel", "key");

-- CreateIndex
CREATE INDEX "AlertLog_placeId_sentAt_idx" ON "AlertLog"("placeId", "sentAt");

-- AddForeignKey
ALTER TABLE "VolcanoChange" ADD CONSTRAINT "VolcanoChange_code_fkey" FOREIGN KEY ("code") REFERENCES "Volcano"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Place" ADD CONSTRAINT "Place_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertSubscription" ADD CONSTRAINT "AlertSubscription_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertLog" ADD CONSTRAINT "AlertLog_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertLog" ADD CONSTRAINT "AlertLog_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "AlertSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===== Kolom geom diisi otomatis dari lat/lon =====
CREATE OR REPLACE FUNCTION siaga_set_geom() RETURNS trigger AS $$
BEGIN
  NEW."geom" := ST_SetSRID(ST_MakePoint(NEW."lon", NEW."lat"), 4326)::geography;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Earthquake','Hotspot','WeatherObservation','AirObservation','CommunityReport','Volcano','Place','Report']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF "lat", "lon" ON %I FOR EACH ROW EXECUTE FUNCTION siaga_set_geom()', t || '_geom_trg', t);
  END LOOP;
END $$;
