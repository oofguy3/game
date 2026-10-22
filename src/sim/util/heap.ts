/**
 * Binary max-heap of numeric values ordered by numeric priority.
 * Values and priorities live in parallel number arrays (no per-entry objects).
 */
export class MaxHeap {
  private values: number[] = [];
  private priorities: number[] = [];

  get size(): number {
    return this.values.length;
  }

  push(value: number, priority: number): void {
    const { values, priorities } = this;
    let i = values.length;
    values.push(value);
    priorities.push(priority);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (priorities[parent] >= priority) break;
      values[i] = values[parent];
      priorities[i] = priorities[parent];
      i = parent;
    }
    values[i] = value;
    priorities[i] = priority;
  }

  /** Removes and returns the value with the highest priority, or undefined when empty. */
  pop(): number | undefined {
    const { values, priorities } = this;
    const n = values.length;
    if (n === 0) return undefined;
    const top = values[0];
    const value = values.pop() as number;
    const priority = priorities.pop() as number;
    const last = n - 1;
    if (last > 0) {
      let i = 0;
      const half = last >> 1;
      while (i < half) {
        let child = 2 * i + 1;
        if (child + 1 < last && priorities[child + 1] > priorities[child]) child++;
        if (priorities[child] <= priority) break;
        values[i] = values[child];
        priorities[i] = priorities[child];
        i = child;
      }
      values[i] = value;
      priorities[i] = priority;
    }
    return top;
  }

  /** Highest priority currently stored, or -Infinity when empty. */
  peekPriority(): number {
    return this.priorities.length > 0 ? this.priorities[0] : -Infinity;
  }

  clear(): void {
    this.values.length = 0;
    this.priorities.length = 0;
  }
}
