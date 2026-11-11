import * as engine from "@pixelation/engine";

// TypeScript assertions do not work on arrow functions, so we have to use
// a normal `function` declaration. I am sad. Again.
//
// https://github.com/microsoft/TypeScript/issues/34523
function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`invariant: ${message}`);
  }
}

const SCREEN_WIDTH = 32;
const SCREEN_HEIGHT = 32;
const SIMULATION_STEP = 1 / 60;
const MAX_FRAME_SECONDS = 0.05;

const root = document.body.querySelector("#ignite");

invariant(root, "Could not get root element.");

const text = root.querySelector("span");

invariant(text, "Could not get text element.");

text!.style.setProperty("--text-shadow-color", "transparent");

const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value));
};

const lerp = (a: number, b: number, t: number) => {
  return a * (1 - t) + b * t;
};

const smooth = (value: number, min: number, max: number) => {
  const t = clamp((value - min) / (max - min), 0, 1);

  return t * t * (3 - 2 * t);
};

class Rectangle {
  // If you're reading this, and you're not me, then you are probably wondering
  // why I am not using the `public` constructor arguments shorthand. I
  // absolutely could, but for my own preferences I'm currently leaning toward
  // the explicit statement of all this data to make it easier to reason about
  // for the reader. You'll see this pattern throughout the rest of the file.
  // Sorry!
  x: number;
  y: number;
  width: number;
  height: number;

  constructor(x: number, y: number, width: number, height: number) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }
}

class Circle {
  x: number;
  y: number;
  radius: number;
  aspect: number;

  constructor(x: number, y: number, radius: number, aspect = 1) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.aspect = aspect;
  }
}

class Noise {
  static DEFAULT_SEED = 23489; // <-- I hit the keyboard and this is what came out.

  static SIZE = 64;
  static WRAP = 63;

  // https://www.cec.uchile.cl/cinetica/pcordero/MC_libros/NumericalRecipesinC.pdf
  // In the section "An Even Quicker Generator", the multiplier and increment values
  // are suggested. Apparently they are "good" for these purposes:
  //
  // > Knuth suggests a = 1664525 as a suitable multiplier for this value [...] H.W. Lewis
  // > has conducted extensive tests of this value [...] with [...] 1013904223
  static MULTIPLIER = 1664525;
  static INCREMENT = 1013904223;

  // We'll be scaling generated values between 0 and 1, mapping the upperbound
  // of integers to the top. Thus, a 32-bit integer's max value is 2 ** 32.
  static MODULUS = 2 ** 32;

  seed: number;
  size: number;
  data: Float32Array;

  constructor(seed = Noise.DEFAULT_SEED) {
    this.size = Noise.SIZE * Noise.SIZE;
    this.seed = seed;
    this.data = new Float32Array(this.size);

    for (let i = 0; i < this.data.length; i++) {
      // Step the seed forward, hacking JS with ">>> 0" to treat the value as a 32-bit integer.
      this.seed =
        (Math.imul(this.seed, Noise.MULTIPLIER) + Noise.INCREMENT) >>> 0;

      // Scale the value and store it.
      this.data[i] = this.seed / Noise.MODULUS;
    }
  }

  sampleOffset(x: number, y: number, offsetX: number, offsetY: number) {
    const wrappedX = (x + offsetX) & Noise.WRAP;
    const wrappedY = (y + offsetY) & Noise.WRAP;

    return this.data[wrappedY * Noise.SIZE + wrappedX]!;
  }

  sample(x: number, y: number) {
    const intX = Math.floor(x);
    const intY = Math.floor(y);

    const smoothX = smooth(x - intX, 0, 1);
    const smoothY = smooth(y - intY, 0, 1);

    // Sample values around the point.
    const topLeft = this.sampleOffset(intX, intY, 0, 0);
    const topRight = this.sampleOffset(intX, intY, 1, 0);
    const bottomLeft = this.sampleOffset(intX, intY, 0, 1);
    const bottomRight = this.sampleOffset(intX, intY, 1, 1);

    // And now blend them...
    const top = lerp(topLeft, topRight, smoothX);
    const bottom = lerp(bottomLeft, bottomRight, smoothX);

    const result = lerp(top, bottom, smoothY);

    return result;
  }
}

class PRNG {
  static DEFAULT_SEED = 4568907; // <-- Random number generated via human-to-keyboard mashing.

  // We'll be shuffling the value around to produce the next one, first
  // shifting left, then right, and then finally left one more time.
  static SHIFT_LEFT_A = 13;
  static SHIFT_LEFT_B = 5;
  static SHIFT_RIGHT = 17;

  // Just like in `Noise`, we'll be scaling the generated integer to be between
  // 0 and 1.
  static MODULUS = 2 ** 32;

  seed: number;

  constructor(seed = PRNG.DEFAULT_SEED) {
    this.seed = seed;
  }

  sample() {
    // Mix the value around.
    this.seed ^= this.seed << PRNG.SHIFT_LEFT_A;
    this.seed ^= this.seed >>> PRNG.SHIFT_RIGHT;
    this.seed ^= this.seed << PRNG.SHIFT_LEFT_B;

    // Then turn the 32-bit integer into a value 0-1.
    const result = (this.seed >>> 0) / PRNG.MODULUS;

    return result;
  }
}

class Field {
  static DEFAULT_SMOOTHING = 0.06;

  size: number;
  smoothing: number;
  data: Float32Array;

  constructor(size: number, smoothing = Field.DEFAULT_SMOOTHING) {
    this.size = size;
    this.smoothing = smoothing;
    this.data = new Float32Array(this.size * this.size);
  }

  zero() {
    this.data.fill(0);
  }

  sample(x: number, y: number, roundX: number, roundY: number) {
    const clampedX = clamp(x, 0, this.size - 1);
    const clampedY = clamp(y, 0, this.size - 1);

    const intX = clamp(Math.floor(clampedX + roundX), 0, this.size - 1);
    const intY = clamp(Math.floor(clampedY + roundY), 0, this.size - 1);

    const raw = this.data[intY * this.size + intX]!;

    const leftIndex = Math.floor(clampedX);
    const topIndex = Math.floor(clampedY);
    const rightIndex = Math.min(leftIndex + 1, this.size - 1);
    const bottomIndex = Math.min(topIndex + 1, this.size - 1);

    const offsetX = clampedX - leftIndex;
    const offsetY = clampedY - topIndex;

    const topLeft = this.data[topIndex * this.size + leftIndex]!;
    const topRight = this.data[topIndex * this.size + rightIndex]!;
    const bottomLeft = this.data[bottomIndex * this.size + leftIndex]!;
    const bottomRight = this.data[bottomIndex * this.size + rightIndex]!;

    const top = lerp(topLeft, topRight, offsetX);
    const bottom = lerp(bottomLeft, bottomRight, offsetX);

    const blended = lerp(top, bottom, offsetY);

    const result = raw + (blended - raw) * this.smoothing;

    return result;
  }

  at(index: number) {
    invariant(
      index >= 0 && index < this.data.length,
      "Field index bounds exceeded.",
    );

    return this.data[index]!;
  }

  set(index: number, value: number) {
    invariant(
      index >= 0 && index < this.data.length,
      "Field index bounds exceeded.",
    );

    this.data[index] = value;
  }

  copy(other: Field) {
    invariant(this.size === other.size, "Field size must match to copy data.");

    for (let i = 0; i < this.data.length; i++) {
      other.data[i] = this.data[i]!;
    }
  }

  move(
    target: Field,
    velocity: CartesianFieldPair,
    rounding: CartesianFieldPair,
    dt: number,
  ) {
    invariant(
      this.size === target.size,
      "Field size of target must match to move data.",
    );
    invariant(
      this.size === velocity.x.size,
      "Field size of velocity.x must match to move data.",
    );
    invariant(
      this.size === velocity.y.size,
      "Field size of velocity.y must match to move data.",
    );
    invariant(
      this.size === rounding.x.size,
      "Field size of rounding.x must match to move data.",
    );
    invariant(
      this.size === rounding.y.size,
      "Field size of rounding.y must match to move data.",
    );

    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        const index = y * this.size + x;

        target.data[index] = this.sample(
          x - velocity.x.at(index) * dt,
          y - velocity.y.at(index) * dt,
          rounding.x.at(index),
          rounding.y.at(index),
        );
      }
    }
  }
}

class CartesianFieldPair {
  x: Field;
  y: Field;

  constructor(x: Field, y: Field) {
    this.x = x;
    this.y = y;
  }
}

class TemporalFieldPair {
  current: Field;
  next: Field;

  constructor(current: Field, next: Field) {
    this.current = current;
    this.next = next;
  }

  swap() {
    [this.current, this.next] = [this.next, this.current];
  }
}

class CartesianTemporalFieldPair {
  current: CartesianFieldPair;
  next: CartesianFieldPair;

  constructor(current: CartesianFieldPair, next: CartesianFieldPair) {
    this.current = current;
    this.next = next;
  }

  swap() {
    [this.current, this.next] = [this.next, this.current];
  }
}

class FuelEmitter extends Field {
  static FADE_START = 0.15;
  static FADE_END = 0.65;
  static THICKNESS_START = 0.2;
  static THICKNESS_END = 0.8;

  core: Circle;

  constructor(size: number, core: Circle, scale = 1) {
    super(size);

    this.core = core;

    for (let y = this.core.y; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        const radius = Math.hypot(
          x - this.core.x,
          (y - this.core.y) / this.core.aspect,
        );

        const distance = Math.abs(radius - this.core.radius * scale);

        const depth =
          (y - this.core.y) / (this.core.radius * scale * core.aspect);

        const fade = smooth(
          depth,
          FuelEmitter.FADE_START,
          FuelEmitter.FADE_END,
        );

        const thickness = smooth(
          distance,
          FuelEmitter.THICKNESS_START,
          FuelEmitter.THICKNESS_END,
        );

        const index = y * this.size + x;
        const value = (1 - thickness) * fade;

        this.set(index, value);
      }
    }
  }
}

class FuelCore extends Circle {
  static X = SCREEN_WIDTH / 2;
  static Y = 21;
  static RADIUS = 11;
  static ASPECT = 0.84;

  constructor() {
    super(FuelCore.X, FuelCore.Y, FuelCore.RADIUS, FuelCore.ASPECT);
  }
}

class Wave {
  static VERTICAL_SPEED = 7;
  static VERTICAL_PHASE = 0.7;

  frequency: number;
  amplitude: number;
  offset: number;
  speed: number;

  constructor(
    frequency: number,
    amplitude: number,
    offset: number,
    speed: number,
  ) {
    this.frequency = frequency;
    this.amplitude = amplitude;
    this.offset = offset;
    this.speed = speed;
  }

  sample(x: number, y: number, t: number) {
    const phase = t * this.speed + this.offset;
    const a = x * this.frequency + phase;
    const b =
      (y + t * Wave.VERTICAL_SPEED) * this.frequency -
      phase * Wave.VERTICAL_PHASE;

    return {
      x: Math.sin(a) * Math.cos(b) * this.amplitude,
      y: -Math.cos(a) * Math.sin(b) * this.amplitude,
    };
  }
}

class Simulation {
  static DEFAULT_SIZE = 32;

  // These values control most of the things in the simulation. Play around to
  // see what modifications do. That's how we got to this point - it's kinda fun.
  static BUOYANCY = 42;
  static CEILING_COOLING_RATE = 18;
  static CEILING_DROOP = 0.04;
  static CEILING_GAP = 10;
  static CEILING_HEIGHT = 8;
  static CEILING_MARGIN = 8;
  static CEILING_NOISE_RANGE = 3;
  static CEILING_NOISE_ROW = 11;
  static CEILING_NOISE_SPEED = 0.2;
  static CEILING_SLOPE = 0.85;
  static COOLING = 0.8;
  static DECAY = 3.75;
  static DRAG = 0.995;
  static EXPANSION = 0.9;
  static FAST_NOISE_AMPLITUDE = 0.15;
  static FAST_NOISE_ROW = 31;
  static FAST_NOISE_SPEED = 2.6;
  static FLAME_COOLING = 0.15;
  static FUEL_BURN_RATE = 2;
  static FUEL_INWARD_SPEED = 11;
  static FUEL_MULTIPLIER = 0.65;
  static FUEL_SUPPLY = 1.5;
  static FUEL_UPWARD_SPEED = 6;
  static FUEL_VELOCITY_RESPONSE_RATE = 6;
  static HEAT_PER_FUEL = 3.2;
  static IGNITION_HEAT = 0.9;
  static LIGHT_PER_FUEL = 5.5;
  static MAX_BUOYANCY_RATIO = 0.25;
  static MAX_COMBUSTION = 0.8;
  static MAX_DOWNWARD_SPEED = 30;
  static MAX_FLAME = 2;
  static MAX_FUEL_COMBUSTION = 0.8;
  static MAX_HEAT = 2;
  static MAX_HORIZONTAL_SPEED = 45;
  static MAX_SIDE_COOLING = 5.4;
  static MAX_UPWARD_SPEED = 55;
  static MIN_BURN = 0.25;
  static MIN_COMBUSTION = 0.1;
  static MIN_FLAME = 0;
  static MIN_FUEL = 0;
  static MIN_FUEL_COMBUSTION = 0.1;
  static MIN_HEAT = 0;
  static NORMALIZER = 0.0001;
  static OFFSET_Y = 4;
  static PLUME_CONSTRAINT = 1.2;
  static PLUME_HEIGHT = 12;
  static PRESSURE_ITERATIONS = 18;
  static SIDE_COOLING_END = 20;
  static SIDE_COOLING_START = 13;
  static SLOW_NOISE_AMPLITUDE = 0.5;
  static SLOW_NOISE_ROW = 17;
  static SLOW_NOISE_SPEED = 0.8;
  static VARIATION = 0.5;
  static VARIATION_AMPLITUDE = 0.8;
  static VARIATION_FREQUENCY_X = 0.5;
  static VARIATION_FREQUENCY_Y = 0.35;
  static VARIATION_SPEED = 2.2;
  static VORTEX_STRENGTH = 8;

  size: number;
  t: number;
  dt: number;
  rng: PRNG;
  noise: Noise;
  core: FuelCore;
  emitter: FuelEmitter;
  flow: Field;
  flame: TemporalFieldPair;
  fuel: TemporalFieldPair;
  heat: TemporalFieldPair;
  pressure: Field;
  rounding: CartesianFieldPair;
  velocity: CartesianTemporalFieldPair;
  vortex: Field;
  ceiling: Field;
  waves: Array<Wave>;

  constructor(size = Simulation.DEFAULT_SIZE) {
    this.size = size;
    this.t = 0;
    this.dt = 0;
    this.rng = new PRNG();
    this.noise = new Noise();
    this.core = new FuelCore();
    this.emitter = new FuelEmitter(this.size, this.core);
    this.flow = new Field(this.size);
    this.flame = new TemporalFieldPair(
      new Field(this.size),
      new Field(this.size),
    );
    this.fuel = new TemporalFieldPair(
      new Field(this.size),
      new Field(this.size),
    );
    this.heat = new TemporalFieldPair(
      new Field(this.size),
      new Field(this.size),
    );
    this.pressure = new Field(this.size);
    this.rounding = new CartesianFieldPair(
      new Field(this.size),
      new Field(this.size),
    );
    this.velocity = new CartesianTemporalFieldPair(
      new CartesianFieldPair(new Field(this.size), new Field(this.size)),
      new CartesianFieldPair(new Field(this.size), new Field(this.size)),
    );
    this.vortex = new Field(this.size);
    this.ceiling = new Field(this.size);
    this.waves = [
      new Wave(0.24, 10, 0, 2.3),
      new Wave(0.43, 5, 2.1, -1.7),
      new Wave(0.71, 3.33, 5.4, 3.1),
    ];
  }

  update(dt: number) {
    this.t += dt;
    this.dt = dt;

    this.updateRounding();
    this.updateVelocity();
    this.updateForces();
    this.updateVortex();
    this.updatePressure();
    this.updateCeiling();
    this.updateHeat();
    this.updateFuel();
  }

  render(surface: engine.graphics.Surface, color: engine.colors.UnpackedColor) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const index = y * this.size + x;
        const value = this.flame.current.at(index);
        const alpha = value < 0.05 ? 0 : Math.min(255, value * 255);

        surface.pixelUnpacked(x, y, color[0], color[1], color[2], alpha);
      }
    }
  }

  updateRounding() {
    const length = this.rounding.x.data.length;

    for (let i = 0; i < length; i++) {
      this.rounding.x.set(i, this.rng.sample());
      this.rounding.y.set(i, this.rng.sample());
    }
  }

  updateVelocity() {
    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        const index = y * this.size + x;

        const px = x - this.velocity.current.x.at(index) * this.dt;
        const py = y - this.velocity.current.y.at(index) * this.dt;

        this.velocity.next.x.set(
          index,
          this.velocity.current.x.sample(
            px,
            py,
            this.rounding.x.at(index),
            this.rounding.y.at(index),
          ) * Simulation.DRAG,
        );
        this.velocity.next.y.set(
          index,
          this.velocity.current.y.sample(
            px,
            py,
            this.rounding.x.at(index),
            this.rounding.y.at(index),
          ) * Simulation.DRAG,
        );
      }
    }

    this.velocity.swap();
  }

  updateForces() {
    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        const index = y * this.size + x;

        const heat = Math.min(1, this.heat.current.at(index));

        let accelerationX = 0;
        let accelerationY = 0;

        for (const wave of this.waves) {
          const acceleration = wave.sample(x, y, this.t);

          accelerationX += acceleration.x;
          accelerationY += acceleration.y;
        }

        const rise = clamp((this.core.y - y) / Simulation.PLUME_HEIGHT, 0, 1);
        accelerationX += (this.core.x - x) * rise * Simulation.PLUME_CONSTRAINT;

        const velocityX = this.velocity.current.x.at(index);
        const velocityY = this.velocity.current.y.at(index);

        this.velocity.current.x.set(
          index,
          velocityX + accelerationX * heat * this.dt,
        );
        this.velocity.current.y.set(
          index,
          velocityY +
            (accelerationY -
              Simulation.BUOYANCY *
                (1 + rise * Simulation.MAX_BUOYANCY_RATIO)) *
              heat *
              this.dt,
        );
      }
    }
  }

  updateVortex() {
    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        const index = y * this.size + x;

        const left = index - 1;
        const right = index + 1;
        const above = index - this.size;
        const below = index + this.size;

        const spin =
          (this.velocity.current.y.at(right) -
            this.velocity.current.y.at(left) -
            this.velocity.current.x.at(below) +
            this.velocity.current.x.at(above)) *
          // We're averaging things between cells, so cut the value in half.
          0.5;

        this.vortex.set(index, spin);
      }
    }

    for (let y = 2; y < this.size - 2; y++) {
      for (let x = 2; x < this.size - 2; x++) {
        const index = y * this.size + x;

        const left = index - 1;
        const right = index + 1;
        const above = index - this.size;
        const below = index + this.size;

        const spinX =
          (Math.abs(this.vortex.at(right)) - Math.abs(this.vortex.at(left))) *
          // Similar to before, we are averaging so cut the value in half.
          0.5;

        const spinY =
          (Math.abs(this.vortex.at(below)) - Math.abs(this.vortex.at(above))) *
          // Similar to before, we are averaging so cut the value in half.
          0.5;

        const length = Math.hypot(spinX, spinY) + Simulation.NORMALIZER;

        const directionX = spinX / length;
        const directionY = spinY / length;

        const strength = this.vortex.at(index) * Simulation.VORTEX_STRENGTH;

        const accelerationX = directionY * strength;
        const accelerationY = -directionX * strength;

        const velocityX = this.velocity.current.x.at(index);
        const velocityY = this.velocity.current.y.at(index);

        this.velocity.current.x.set(
          index,
          clamp(
            velocityX + accelerationX * this.dt,
            -Simulation.MAX_HORIZONTAL_SPEED,
            Simulation.MAX_HORIZONTAL_SPEED,
          ),
        );

        this.velocity.current.y.set(
          index,
          clamp(
            velocityY + accelerationY * this.dt,
            -Simulation.MAX_UPWARD_SPEED,
            Simulation.MAX_DOWNWARD_SPEED,
          ),
        );
      }
    }
  }

  updatePressure() {
    this.pressure.zero();
    this.flow.zero();

    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        const index = y * this.size + x;

        const left = index - 1;
        const right = index + 1;
        const above = index - this.size;
        const below = index + this.size;

        const burn =
          this.fuel.current.at(index) *
          smooth(
            this.heat.current.at(index),
            Simulation.MIN_FUEL_COMBUSTION,
            Simulation.MAX_FUEL_COMBUSTION,
          );

        this.flow.set(
          index,
          (this.velocity.current.x.at(right) -
            this.velocity.current.x.at(left) +
            this.velocity.current.y.at(below) -
            this.velocity.current.y.at(above)) *
            0.5 -
            Simulation.EXPANSION * burn,
        );
      }
    }

    for (let i = 0; i < Simulation.PRESSURE_ITERATIONS; i++) {
      for (let y = 1; y < this.size - 1; y++) {
        for (let x = 1; x < this.size - 1; x++) {
          const index = y * this.size + x;

          const left = index - 1;
          const right = index + 1;
          const above = index - this.size;
          const below = index + this.size;

          this.pressure.set(
            index,
            (this.pressure.at(left) +
              this.pressure.at(right) +
              this.pressure.at(above) +
              this.pressure.at(below) -
              this.flow.at(index)) *
              0.25,
          );
        }
      }
    }

    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        const index = y * this.size + x;

        const left = index - 1;
        const right = index + 1;
        const above = index - this.size;
        const below = index + this.size;

        const velocityX = this.velocity.current.x.at(index);
        const velocityY = this.velocity.current.y.at(index);

        this.velocity.current.x.set(
          index,
          velocityX - (this.pressure.at(right) - this.pressure.at(left)) * 0.5,
        );
        this.velocity.current.y.set(
          index,
          velocityY - (this.pressure.at(below) - this.pressure.at(above)) * 0.5,
        );
      }
    }
  }

  updateCeiling() {
    const noise = this.noise.sample(
      this.t * Simulation.CEILING_NOISE_SPEED,
      Simulation.CEILING_NOISE_ROW,
    );
    const peak = this.core.x + (noise - 0.5) * Simulation.CEILING_NOISE_RANGE;

    for (let x = 1; x < this.size - 1; x++) {
      const phase = (x - peak) / Simulation.CEILING_GAP;
      const distance =
        Math.abs(phase - Math.round(phase)) * Simulation.CEILING_GAP;

      const value =
        Simulation.CEILING_MARGIN +
        distance * Simulation.CEILING_SLOPE +
        Math.abs(x - this.core.x) * Simulation.CEILING_DROOP;

      this.ceiling.set(x, value);
    }
  }

  updateHeat() {
    this.heat.current.move(
      this.heat.next,
      this.velocity.current,
      this.rounding,
      this.dt,
    );
    this.flame.current.move(
      this.flame.next,
      this.velocity.current,
      this.rounding,
      this.dt,
    );
    this.fuel.current.move(
      this.fuel.next,
      this.velocity.current,
      this.rounding,
      this.dt,
    );

    const flameRetention = Math.exp(-Simulation.DECAY * this.dt);

    for (let y = 1; y < this.size - 1; y++) {
      const canvasY = y + Simulation.OFFSET_Y;

      for (let x = 1; x < this.size - 1; x++) {
        const index = y * this.size + x;

        const heat = this.heat.next.at(index);
        const fuel = this.fuel.next.at(index);
        const flame = this.flame.next.at(index);

        const ceiling = this.ceiling.at(x);
        const ceilingCooling =
          1 - smooth(canvasY, ceiling, ceiling + Simulation.CEILING_HEIGHT);

        const ceilingRetention =
          canvasY < ceiling
            ? 0
            : Math.exp(
                -Simulation.CEILING_COOLING_RATE * ceilingCooling * this.dt,
              );

        const burn =
          Simulation.MIN_BURN +
          smooth(heat, Simulation.MIN_COMBUSTION, Simulation.MAX_COMBUSTION);

        const used = Math.min(
          fuel,
          fuel * burn * Simulation.FUEL_BURN_RATE * this.dt,
        );

        const generatedHeat = used * Simulation.HEAT_PER_FUEL;
        const generatedLight = used * Simulation.LIGHT_PER_FUEL;

        const distance = Math.hypot(x - this.core.x, y - this.core.y);

        const sideCooling =
          smooth(
            distance,
            Simulation.SIDE_COOLING_START,
            Simulation.SIDE_COOLING_END,
          ) * Simulation.MAX_SIDE_COOLING;

        const removedHeat = (Simulation.COOLING + sideCooling) * this.dt;
        const removedFuel = sideCooling * fuel * this.dt;

        this.heat.next.set(
          index,
          clamp(
            heat + generatedHeat - removedHeat,
            Simulation.MIN_HEAT,
            Simulation.MAX_HEAT,
          ) * ceilingRetention,
        );

        this.flame.next.set(
          index,
          clamp(
            flame * flameRetention +
              generatedLight -
              removedHeat * Simulation.FLAME_COOLING,
            Simulation.MIN_FLAME,
            Simulation.MAX_FLAME,
          ) * ceilingRetention,
        );

        this.fuel.next.set(
          index,
          Math.max(Simulation.MIN_FUEL, fuel - used - removedFuel) *
            ceilingRetention,
        );
      }
    }

    this.heat.swap();
    this.flame.swap();
    this.fuel.swap();
  }

  updateFuel() {
    const sourceFuel =
      Simulation.FUEL_MULTIPLIER +
      this.noise.sample(
        this.t * Simulation.SLOW_NOISE_SPEED,
        Simulation.SLOW_NOISE_ROW,
      ) *
        Simulation.SLOW_NOISE_AMPLITUDE +
      this.noise.sample(
        this.t * Simulation.FAST_NOISE_SPEED,
        Simulation.FAST_NOISE_ROW,
      ) *
        Simulation.FAST_NOISE_AMPLITUDE;

    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        const index = y * this.size + x;

        const source = this.emitter.at(index);

        if (source === 0) {
          continue;
        }

        const noise = this.noise.sample(
          x * Simulation.VARIATION_FREQUENCY_X,
          y * Simulation.VARIATION_FREQUENCY_Y +
            this.t * Simulation.VARIATION_SPEED,
        );

        const variation =
          Simulation.VARIATION + noise * Simulation.VARIATION_AMPLITUDE;

        const minimumFuel =
          source * sourceFuel * variation * Simulation.FUEL_SUPPLY;
        const minimumHeat = source * Simulation.IGNITION_HEAT;

        const fuel = this.fuel.current.at(index);
        const heat = this.heat.current.at(index);

        this.fuel.current.set(index, Math.max(fuel, minimumFuel));
        this.heat.current.set(index, Math.max(heat, minimumHeat));

        const targetVelocityX =
          ((this.core.x - x) / this.core.radius) * Simulation.FUEL_INWARD_SPEED;
        const targetVelocityY = -source * Simulation.FUEL_UPWARD_SPEED;

        const velocity =
          1 -
          Math.exp(-source * Simulation.FUEL_VELOCITY_RESPONSE_RATE * this.dt);

        const velocityX = this.velocity.current.x.at(index);
        const velocityY = this.velocity.current.y.at(index);

        this.velocity.current.x.set(
          index,
          lerp(velocityX, targetVelocityX, velocity),
        );
        this.velocity.current.y.set(
          index,
          Math.min(velocityY, targetVelocityY),
        );
      }
    }
  }
}

class Swatch {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  color: engine.colors.UnpackedColor;
  last: string;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.context = this.canvas.getContext("2d", {
      willReadFrequently: true,
    })!;

    this.canvas.width = 1;
    this.canvas.height = 1;

    this.color = [0, 0, 0, 255] as engine.colors.UnpackedColor;
    this.last = "";
  }

  update() {
    const style = window.getComputedStyle(document.documentElement);

    if (style.color !== this.last) {
      this.last = style.color;

      this.context.clearRect(0, 0, 1, 1);
      this.context.fillStyle = style.color;
      this.context.fillRect(0, 0, 1, 1);

      const { data } = this.context.getImageData(0, 0, 1, 1);

      this.color[0] = data[0]!;
      this.color[1] = data[1]!;
      this.color[2] = data[2]!;
    }
  }
}

class Logo {
  static DELAY = 5_000;
  static DURATION = 5_000;

  update(t: number, color: engine.colors.UnpackedColor) {
    const alpha = clamp((t - Logo.DELAY) / Logo.DURATION, 0, 1);
    const value = `rgba(${swatch.color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
    text!.style.setProperty("--text-shadow-color", value);
  }
}

const simulation = new Simulation();
const swatch = new Swatch();
const logo = new Logo();
let elapsed = 0;
let enabled = false;

const prefersReducedMotionQuery = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
);

const handleMotionPreference = (isReduced: boolean) => {
  enabled = !isReduced;

  if (isReduced) {
    // A decent-enough static frame (found from trying different times, have a
    // play it is fun).
    elapsed = 4.65;
  }
};

prefersReducedMotionQuery.addEventListener("change", (event) => {
  handleMotionPreference(event.matches);
});

handleMotionPreference(prefersReducedMotionQuery.matches);

const setup: engine.lifecycle.Setup = (surface, inputs, audio) => {
  if (surface instanceof engine.graphics.Screen) {
    root.appendChild(surface.canvas);
  }
};

const update: engine.lifecycle.Update = (surface, inputs, audio, dt, t) => {
  if (enabled) {
    elapsed += Math.min(dt / 1_000, MAX_FRAME_SECONDS);
  }

  while (elapsed >= SIMULATION_STEP) {
    simulation.update(SIMULATION_STEP);
    elapsed -= SIMULATION_STEP;
  }

  swatch.update();
  logo.update(t, swatch.color);
};

const render: engine.lifecycle.Render = (surface, inputs, dt, t, fps) => {
  for (let i = 0; i < surface.image.data.length; i += 4) {
    surface.image.data[i] = 0;
    surface.image.data[i + 1] = 0;
    surface.image.data[i + 2] = 0;
    surface.image.data[i + 3] = 0;
  }

  simulation.render(surface, swatch.color);
};

engine.lifecycle.run({
  surface: new engine.graphics.Screen(SCREEN_WIDTH, SCREEN_HEIGHT),
  setup,
  update,
  render,
});
