/**
 * Location smoothing utilities for smooth live tracking
 * Implements Kalman filter for GPS smoothing and bearing stabilization
 */

// Simple 1D Kalman filter for smoothing GPS coordinates
export class KalmanFilter {
    private q: number; // Process noise
    private r: number; // Measurement noise
    private x: number; // Estimated value
    private p: number; // Estimation error covariance
    private k: number; // Kalman gain
    private initialized: boolean = false;

    constructor(q: number = 0.00001, r: number = 0.001) {
        this.q = q;
        this.r = r;
        this.x = 0;
        this.p = 1;
        this.k = 0;
    }

    filter(measurement: number): number {
        if (!this.initialized) {
            this.x = measurement;
            this.initialized = true;
            return measurement;
        }

        // Prediction update
        this.p = this.p + this.q;

        // Measurement update
        this.k = this.p / (this.p + this.r);
        this.x = this.x + this.k * (measurement - this.x);
        this.p = (1 - this.k) * this.p;

        return this.x;
    }

    reset() {
        this.initialized = false;
        this.x = 0;
        this.p = 1;
    }
}

// GPS Location smoother combining lat/lon Kalman filters
export class LocationSmoother {
    private latFilter: KalmanFilter;
    private lonFilter: KalmanFilter;
    private bearingFilter: KalmanFilter;
    private lastBearing: number = 0;

    constructor() {
        // Lower Q = smoother but more lag, higher Q = more responsive but noisier
        // GPS accuracy is typically 3-10m, so we tune for that
        this.latFilter = new KalmanFilter(0.00001, 0.0001);
        this.lonFilter = new KalmanFilter(0.00001, 0.0001);
        // Bearing filter with higher responsiveness
        this.bearingFilter = new KalmanFilter(0.1, 0.5);
    }

    smoothLocation(lat: number, lon: number): [number, number] {
        return [
            this.latFilter.filter(lat),
            this.lonFilter.filter(lon)
        ];
    }

    // Smooth bearing with additional anti-spin protection
    smoothBearing(rawBearing: number, speed: number): number | null {
        // Don't update bearing if speed is too low (GPS heading unreliable)
        if (speed < 2) {
            return null; // Keep current bearing
        }

        // Normalize bearing to 0-360
        let bearing = ((rawBearing % 360) + 360) % 360;

        // Handle wrap-around (e.g., 359° -> 1°)
        if (this.lastBearing !== 0) {
            const diff = bearing - this.lastBearing;
            if (diff > 180) bearing -= 360;
            if (diff < -180) bearing += 360;
        }

        // Apply Kalman filter
        const smoothed = this.bearingFilter.filter(bearing);

        // Normalize result back to 0-360
        const normalizedBearing = ((smoothed % 360) + 360) % 360;
        this.lastBearing = normalizedBearing;

        return normalizedBearing;
    }

    reset() {
        this.latFilter.reset();
        this.lonFilter.reset();
        this.bearingFilter.reset();
        this.lastBearing = 0;
    }
}

// Bearing animator that handles wrap-around correctly for CSS rotation
export class BearingAnimator {
    private currentRotation: number = 0; // Cumulative rotation (can go beyond 360)
    private lastRawBearing: number = 0;
    private initialized: boolean = false;

    // Update target bearing and calculate shortest rotation path
    setBearing(newBearing: number): number {
        // Normalize input to 0-360
        const normalizedBearing = ((newBearing % 360) + 360) % 360;

        if (!this.initialized) {
            this.currentRotation = normalizedBearing;
            this.lastRawBearing = normalizedBearing;
            this.initialized = true;
            return this.currentRotation;
        }

        // Calculate the shortest path delta
        let delta = normalizedBearing - this.lastRawBearing;

        // Wrap-around: choose shortest path
        if (delta > 180) {
            delta -= 360;
        } else if (delta < -180) {
            delta += 360;
        }

        // Apply delta to cumulative rotation
        this.currentRotation += delta;
        this.lastRawBearing = normalizedBearing;

        return this.currentRotation;
    }

    getCurrentRotation(): number {
        return this.currentRotation;
    }

    reset() {
        this.currentRotation = 0;
        this.lastRawBearing = 0;
        this.initialized = false;
    }
}

// LERP (Linear Interpolation) animator for smooth position transitions
export class PositionAnimator {
    private startLat: number = 0;
    private startLon: number = 0;
    private targetLat: number = 0;
    private targetLon: number = 0;
    private startTime: number = 0;
    private duration: number = 300; // ms
    private animationId: number | null = null;
    private onUpdate: ((lat: number, lon: number) => void) | null = null;

    setUpdateCallback(callback: (lat: number, lon: number) => void) {
        this.onUpdate = callback;
    }

    animateTo(lat: number, lon: number, durationMs: number = 300) {
        // Cancel any existing animation
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
        }

        // If no previous position, jump directly
        if (this.targetLat === 0 && this.targetLon === 0) {
            this.targetLat = lat;
            this.targetLon = lon;
            if (this.onUpdate) {
                this.onUpdate(lat, lon);
            }
            return;
        }

        // Start animation from current target (smooth chaining)
        this.startLat = this.targetLat;
        this.startLon = this.targetLon;
        this.targetLat = lat;
        this.targetLon = lon;
        this.startTime = performance.now();
        this.duration = durationMs;

        this.animate();
    }

    private animate = () => {
        const now = performance.now();
        const elapsed = now - this.startTime;
        const progress = Math.min(elapsed / this.duration, 1);

        // Ease-out curve for natural deceleration
        const eased = 1 - Math.pow(1 - progress, 3);

        const currentLat = this.startLat + (this.targetLat - this.startLat) * eased;
        const currentLon = this.startLon + (this.targetLon - this.startLon) * eased;

        if (this.onUpdate) {
            this.onUpdate(currentLat, currentLon);
        }

        if (progress < 1) {
            this.animationId = requestAnimationFrame(this.animate);
        } else {
            this.animationId = null;
        }
    };

    stop() {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
}

// Accelerometer helper for velocity estimation
export class AccelerometerHelper {
    private lastTimestamp: number = 0;
    private velocityX: number = 0;
    private velocityY: number = 0;
    private isListening: boolean = false;
    private permissionGranted: boolean = false;

    async requestPermission(): Promise<boolean> {
        // Check if permission API exists (iOS 13+)
        if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
            try {
                const permission = await (DeviceMotionEvent as any).requestPermission();
                this.permissionGranted = permission === 'granted';
                return this.permissionGranted;
            } catch (e) {
                console.warn('Accelerometer permission denied:', e);
                return false;
            }
        }
        // Permission not needed on other platforms
        this.permissionGranted = true;
        return true;
    }

    start(onVelocityUpdate?: (vx: number, vy: number) => void) {
        if (this.isListening || !this.permissionGranted) return;

        const handler = (event: DeviceMotionEvent) => {
            const accel = event.accelerationIncludingGravity;
            if (!accel || accel.x === null || accel.y === null) return;

            const now = performance.now();
            if (this.lastTimestamp === 0) {
                this.lastTimestamp = now;
                return;
            }

            const dt = (now - this.lastTimestamp) / 1000;
            this.lastTimestamp = now;

            // Simple velocity integration (with decay to prevent drift)
            const decay = 0.95;
            this.velocityX = (this.velocityX + accel.x * dt) * decay;
            this.velocityY = (this.velocityY + accel.y * dt) * decay;

            if (onVelocityUpdate) {
                onVelocityUpdate(this.velocityX, this.velocityY);
            }
        };

        window.addEventListener('devicemotion', handler);
        this.isListening = true;
    }

    getVelocity(): { vx: number; vy: number } {
        return { vx: this.velocityX, vy: this.velocityY };
    }

    stop() {
        this.isListening = false;
        this.velocityX = 0;
        this.velocityY = 0;
    }
}

// Speed classifications - 4 tiers for precise tracking
export type SpeedClass = 'stationary' | 'walking' | 'vehicle' | 'fast_vehicle';

// Stable location tracker with dynamic buffer zone and speed-based updates
export class StableLocationTracker {
    private anchorLat: number = 0;
    private anchorLon: number = 0;
    private displayLat: number = 0;
    private displayLon: number = 0;
    private lastRawLat: number = 0;
    private lastRawLon: number = 0;
    private lastUpdateTime: number = 0;
    private speedHistory: number[] = [];
    private currentSpeedClass: SpeedClass = 'stationary';
    private predictedBearing: number = 0;
    private directionChangeBuffer: number[] = [];

    // Configuration - dynamic based on speed
    private initialized: boolean = false;

    // Dynamic buffer zones based on speed (in meters)
    // Larger buffer = more stable but less responsive
    private bufferZones: Record<SpeedClass, number> = {
        stationary: 15,      // Large buffer to prevent GPS jitter
        walking: 10,         // Moderate buffer for smooth walking
        vehicle: 5,          // Smaller buffer for accurate driving
        fast_vehicle: 3      // Minimal buffer for highway speeds
    };

    // Polling intervals based on speed (in ms)
    // Faster speed = more frequent updates
    private pollIntervals: Record<SpeedClass, number> = {
        stationary: 10000,   // 10s when not moving
        walking: 5000,       // 5s at walking pace
        vehicle: 2000,       // 2s in vehicle
        fast_vehicle: 1000   // 1s at high speed
    };

    // Animation durations based on speed (in ms)
    // Faster speed = shorter, snappier animations
    private animationDurations: Record<SpeedClass, number> = {
        stationary: 1000,
        walking: 700,
        vehicle: 400,
        fast_vehicle: 250
    };

    // Haversine distance in meters
    private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371000; // Earth radius in meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    // Calculate bearing from one point to another
    private calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
        const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
        const bearing = Math.atan2(y, x) * 180 / Math.PI;
        return (bearing + 360) % 360;
    }

    // Update location and return stable display position
    updateLocation(rawLat: number, rawLon: number): {
        displayLat: number;
        displayLon: number;
        speed: number;
        speedClass: SpeedClass;
        shouldUpdate: boolean;
        animationDuration: number;
    } {
        const now = Date.now();

        if (!this.initialized) {
            this.anchorLat = rawLat;
            this.anchorLon = rawLon;
            this.displayLat = rawLat;
            this.displayLon = rawLon;
            this.lastRawLat = rawLat;
            this.lastRawLon = rawLon;
            this.lastUpdateTime = now;
            this.initialized = true;
            return {
                displayLat: rawLat,
                displayLon: rawLon,
                speed: 0,
                speedClass: 'stationary',
                shouldUpdate: true,
                animationDuration: 0
            };
        }

        // Calculate distance from anchor
        const distanceFromAnchor = this.haversineDistance(this.anchorLat, this.anchorLon, rawLat, rawLon);

        // Calculate speed (m/s)
        const timeDelta = (now - this.lastUpdateTime) / 1000;
        const distanceMoved = this.haversineDistance(this.lastRawLat, this.lastRawLon, rawLat, rawLon);
        const speed = timeDelta > 0 ? distanceMoved / timeDelta : 0;

        // Update speed history (keep last 5)
        this.speedHistory.push(speed);
        if (this.speedHistory.length > 5) this.speedHistory.shift();

        // Average speed for classification
        const avgSpeed = this.speedHistory.reduce((a, b) => a + b, 0) / this.speedHistory.length;

        // Classify speed - 4 tiers for precise tracking
        let speedClass: SpeedClass;
        if (avgSpeed < 0.5) {
            speedClass = 'stationary';
        } else if (avgSpeed < 2) {
            speedClass = 'walking';
        } else if (avgSpeed < 10) {
            speedClass = 'vehicle';
        } else {
            speedClass = 'fast_vehicle';
        }
        this.currentSpeedClass = speedClass;

        // Get current buffer based on speed
        const currentBuffer = this.bufferZones[speedClass];

        // Calculate bearing of movement
        if (distanceMoved > 1) {
            const moveBearing = this.calculateBearing(this.lastRawLat, this.lastRawLon, rawLat, rawLon);
            this.directionChangeBuffer.push(moveBearing);
            if (this.directionChangeBuffer.length > 3) this.directionChangeBuffer.shift();

            // Average recent bearings for prediction
            this.predictedBearing = this.directionChangeBuffer.reduce((a, b) => a + b, 0) / this.directionChangeBuffer.length;
        }

        // Update last raw position
        this.lastRawLat = rawLat;
        this.lastRawLon = rawLon;
        this.lastUpdateTime = now;

        // Buffer zone logic: only update display if outside buffer
        let shouldMoveMarker = false;
        let newDisplayLat = this.displayLat;
        let newDisplayLon = this.displayLon;

        if (distanceFromAnchor > currentBuffer) {
            // Outside buffer - move anchor to new position
            this.anchorLat = rawLat;
            this.anchorLon = rawLon;
            newDisplayLat = rawLat;
            newDisplayLon = rawLon;
            shouldMoveMarker = true;
        } else if (distanceFromAnchor > currentBuffer * 0.7) {
            // Near edge of buffer - smoothly approach new position
            // Move display toward raw position with damping
            const blend = 0.3;
            newDisplayLat = this.displayLat + (rawLat - this.displayLat) * blend;
            newDisplayLon = this.displayLon + (rawLon - this.displayLon) * blend;
            shouldMoveMarker = true;
        }
        // Else: inside buffer - keep display at current position (stable)

        if (shouldMoveMarker) {
            this.displayLat = newDisplayLat;
            this.displayLon = newDisplayLon;
        }

        return {
            displayLat: this.displayLat,
            displayLon: this.displayLon,
            speed: avgSpeed,
            speedClass,
            shouldUpdate: shouldMoveMarker,
            animationDuration: this.animationDurations[speedClass]
        };
    }

    // Get recommended polling interval based on current speed
    getPollingInterval(): number {
        return this.pollIntervals[this.currentSpeedClass];
    }

    // Get current speed classification
    getSpeedClass(): SpeedClass {
        return this.currentSpeedClass;
    }

    // Get predicted bearing for movement direction
    getPredictedBearing(): number {
        return this.predictedBearing;
    }

    reset() {
        this.initialized = false;
        this.anchorLat = 0;
        this.anchorLon = 0;
        this.displayLat = 0;
        this.displayLon = 0;
        this.speedHistory = [];
        this.currentSpeedClass = 'stationary';
        this.directionChangeBuffer = [];
    }
}
