/** Country outlines are copied from iOS Resources/country-outlines.json (Natural Earth public-domain data). */
export type CountryOutline = { n: string; r: number[][][] };
export type MapCoordinate = { lat: number; lng: number };

let outlinesRequest: Promise<CountryOutline[]> | undefined;

/** Shared data is fetched once; failed fetches are retryable. */
export function loadShareOutlines(): Promise<CountryOutline[]> {
    if (!outlinesRequest) {
        outlinesRequest = fetch("/maps/country-outlines.json")
            .then(async response => {
                if (!response.ok) throw new Error("Country outlines unavailable");
                const json: unknown = await response.json();
                if (!Array.isArray(json)) throw new Error("Invalid country outlines");
                return json as CountryOutline[];
            }).catch(error => {
                outlinesRequest = undefined;
                throw error;
            });
    }
    return outlinesRequest;
}

function contains(point: MapCoordinate, ring: number[][]): boolean {
    if (ring.length < 3) return false;
    let inside = false;
    let previous = ring.length - 1;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[previous];
        if (a.length === 2 && b.length === 2 &&
            (a[1] > point.lat) !== (b[1] > point.lat)) {
            const intersect = (b[0] - a[0]) * (point.lat - a[1]) / (b[1] - a[1]) + a[0];
            if (point.lng < intersect) inside = !inside;
        }
        previous = i;
    }
    return inside;
}

/** Coastal rounded coordinates may sit offshore; use nearest border within 0.75 degrees. */
export function findShareCountry(shapes: CountryOutline[], point: MapCoordinate): CountryOutline | null {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) ||
        Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return null;
    const inside = shapes.find(shape => shape.r.some(ring => contains(point, ring)));
    if (inside) return inside;
    let nearest: CountryOutline | null = null;
    let best = Infinity;
    const weight = Math.max(0.2, Math.cos(point.lat * Math.PI / 180));
    for (const shape of shapes) {
        for (const ring of shape.r) {
            for (const vertex of ring) {
                if (vertex.length !== 2) continue;
                // Treat both sides of the date line as adjacent.
                const longitude = vertex[0] + 360 * Math.round((point.lng - vertex[0]) / 360);
                const dx = (longitude - point.lng) * weight;
                const dy = vertex[1] - point.lat;
                const d = dx * dx + dy * dy;
                if (d < best) { best = d; nearest = shape; }
            }
        }
    }
    return best <= 0.75 * 0.75 ? nearest : null;
}

/** Unwrap rings without drawing a long line across the antimeridian. */
export function unwrapShareRings(shape: CountryOutline, longitude: number): number[][][] {
    return shape.r.map(ring => {
        let previous = ring.length ? ring[0][0] + 360 * Math.round((longitude - ring[0][0]) / 360) : longitude;
        return ring.map((vertex, index) => {
            if (vertex.length !== 2) return vertex;
            if (index > 0) previous = vertex[0] + 360 * Math.round((previous - vertex[0]) / 360);
            return [previous, vertex[1]];
        });
    });
}

export function drawShareCountryMap(
    ctx: CanvasRenderingContext2D,
    shapes: CountryOutline[],
    pin: MapCoordinate,
    rect: { x: number; y: number; width: number; height: number },
    color = "#c9a66b",
): void {
    const { x, y, width, height } = rect;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
    const shape = findShareCountry(shapes, pin);
    if (shape) {
        const rings = unwrapShareRings(shape, pin.lng);
        const vertices = rings.flat(2).filter(p => p.length === 2);
        const lngs = vertices.map(p => p[0]);
        const lats = vertices.map(p => p[1]);
        const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
        const minLat = Math.min(...lats), maxLat = Math.max(...lats);
        const longitudeScale = Math.max(0.2, Math.cos((minLat + maxLat) / 2 * Math.PI / 180));
        const factor = Math.min((width - 32) / Math.max(0.01, (maxLng - minLng) * longitudeScale),
            (height - 32) / Math.max(0.01, maxLat - minLat));
        const project = (p: number[]) => ({
            x: x + width / 2 + (p[0] - (minLng + maxLng) / 2) * longitudeScale * factor,
            y: y + height / 2 - (p[1] - (minLat + maxLat) / 2) * factor,
        });
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = "round";
        for (const ring of rings) {
            if (ring.length < 3) continue;
            const start = project(ring[0]);
            ctx.beginPath(); ctx.moveTo(start.x, start.y);
            for (const point of ring.slice(1)) {
                const p = project(point);
                ctx.lineTo(p.x, p.y);
            }
            ctx.closePath(); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        const longitude = pin.lng + 360 * Math.round(((minLng + maxLng) / 2 - pin.lng) / 360);
        const dot = project([longitude, pin.lat]);
        ctx.strokeStyle = color; ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(dot.x, dot.y, 8, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(dot.x, dot.y, 3, 0, Math.PI * 2); ctx.fill();
    } else {
        // Small islands and remote water must never create a blank map slot.
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.3;
        for (const fraction of [0.25, 0.5, 0.75]) {
            ctx.beginPath();
            ctx.moveTo(x + width * fraction, y + 8); ctx.lineTo(x + width * fraction, y + height - 8);
            ctx.moveTo(x + 8, y + height * fraction); ctx.lineTo(x + width - 8, y + height * fraction);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color; ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x + width / 2, y + height / 2, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x + width / 2, y + height / 2, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
}
