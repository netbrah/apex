/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/* eslint-disable */
/**
 * Lightweight zod-compatible shim for vendored tool schemas.
 *
 * Runtime validation is handled by core tool schemas; this shim exists so the
 * imported tool modules can compile and expose metadata without pulling zod.
 */

export interface ZodLikeSchema<T = unknown> {
  optional(): ZodLikeSchema<T | undefined>;
  nullish(): ZodLikeSchema<T | null | undefined>;
  default(_value: unknown): ZodLikeSchema<T>;
  describe(_text: string): ZodLikeSchema<T>;
}

class Schema<T = unknown> implements ZodLikeSchema<T> {
  optional(): ZodLikeSchema<T | undefined> {
    return new Schema<T | undefined>();
  }

  nullish(): ZodLikeSchema<T | null | undefined> {
    return new Schema<T | null | undefined>();
  }

  default(_value: unknown): ZodLikeSchema<T> {
    return this;
  }

  describe(_text: string): ZodLikeSchema<T> {
    return this;
  }
}

function schema<T = unknown>(): ZodLikeSchema<T> {
  return new Schema<T>();
}

export const z = {
  string(): ZodLikeSchema<string> {
    return schema<string>();
  },
  number(): ZodLikeSchema<number> {
    return schema<number>();
  },
  boolean(): ZodLikeSchema<boolean> {
    return schema<boolean>();
  },
  object<T extends Record<string, unknown>>(
    _shape: T,
  ): ZodLikeSchema<{ [K in keyof T]?: unknown }> {
    return schema();
  },
  array<T>(_inner: ZodLikeSchema<T>): ZodLikeSchema<T[]> {
    return schema<T[]>();
  },
  enum<T extends readonly string[]>(_values: T): ZodLikeSchema<T[number]> {
    return schema<T[number]>();
  },
  union<T extends readonly ZodLikeSchema<unknown>[]>(
    _schemas: T,
  ): ZodLikeSchema {
    return schema();
  },
};

export namespace z {
  export type infer<T> = T extends ZodLikeSchema<infer U> ? U : unknown;
}
