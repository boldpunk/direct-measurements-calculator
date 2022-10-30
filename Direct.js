export default class DirectMeasurement {
  /**
   * Calculate the direct measurement
   * @class
   * @param {array} nums - the array of measurements
   * @param {number} smallestScale - the smallest scale value
   * @param {number} coefficientN - the coefficient number, corresponding to the confidence limit, for the number of measurements made
   */
  constructor(nums, smallestScale, coefficientN, type) {
    this.nums = Array.isArray(nums) ? nums : [];
    this.smallestScale = isNaN(smallestScale) ? 0 : smallestScale;
    this.coefficientN = isNaN(coefficientN) ? 0 : coefficientN;
    this.type = type;
    this.coefficientInf = 1.96;
    this.confidenceLimit = 95;
  }

  /**
   * Shorten the provided number
   * @param {number} number the number you want to shorten
   * @param {number} limit how far you want to limit to, default = 5
   * @returns {number}
   */
  #shorten(number, limit = 10) {
    if (typeof number === "number") {
      return number.toFixed(limit);
    }
  }

  averageValue() {
    if (this.nums.length === 0) return 0;
    const sum = this.nums.reduce((prev, curr) => prev + curr, 0);
    return this.#shorten(sum / this.nums.length, 3);
  }

  standardError() {
    if (this.nums.length === 0 || this.nums.length === 1) return 0;
    const numerator = this.nums.reduce((prev, curr) => {
      return prev + Math.pow(curr - this.averageValue(), 2);
    }, 0);
    const denominator = this.nums.length * (this.nums.length - 1);

    return this.#shorten(Math.sqrt(numerator / denominator));
  }

  deviceError() {
    return this.#shorten(
      this.type === "vernier" ? this.smallestScale : this.smallestScale / 2
    );
  }

  randomError() {
    return this.#shorten(this.standardError() * this.coefficientN);
  }

  measurementError() {
    return this.#shorten((this.deviceError() / 3) * this.coefficientInf);
  }

  absoluteError() {
    return this.#shorten(
      Math.sqrt(
        Math.pow(this.measurementError(), 2) + Math.pow(this.randomError(), 2)
      )
    );
  }

  relativeError() {
    if (this.averageValue() === 0) return 0;
    return this.#shorten((this.absoluteError() / this.averageValue()) * 100);
  }

  confidenceLimitInt() {
    return this.#shorten(this.confidenceLimit * 0.01, 5);
  }

  calculate() {
    return `<b>x</b> = ${this.averageValue()} ± ${this.absoluteError()} [unit], <b>ε</b> = ${this.relativeError()}%, at <b>β</b> = ${this.confidenceLimitInt()}
    `;
  }
}

const example = new DirectMeasurement(
  [155.05, 155.2, 155.25, 154.9, 155.5],
  0.05,
  2.145
);

// console.log("------------ Example ------------");
// console.log("Average Value: " + example.averageValue());
// console.log("Standard Error: " + example.standardError());
// console.log("Random Error: " + example.randomError());
// console.log("Device Error: " + example.deviceError());
// console.log("Measurement Error: " + example.measurementError());
// console.log("Absolute Error: " + example.absoluteError());
// console.log("Result: " + example.calculate());
