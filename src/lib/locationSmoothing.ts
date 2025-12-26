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
