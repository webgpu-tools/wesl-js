import { throwClickableError } from "../ClickableError.ts";
import type { ExtendedGPUValidationError } from "./ShaderModule.ts";

/**
 * We want the WebGPU compilation errors to point at WESL code.
 * The native facilities are `device.pushErrorScope`, `device.popErrorScope`
 * and `device.addEventListener("uncapturederror", (ev) => {})`
 *
 * So we track the error scopes.
 * Then, when creating a shader module from WESL code, we forcibly capture the errors.
 * And then re-emit them to the nearest validation error scope.
 * If there isn't one, we throw it as an uncapturederror
 */
type ErrorScope = {
  filter: GPUErrorFilter;
  errors: Promise<GPUError | null>[];
};

/**
 * A {@link GPUDevice} with extensions for WESL. Created with {@link makeWeslDevice}.
 * Used to make error reporting point at the orignal WESL sources.
 */
export interface WeslDevice extends GPUDevice {
  /**
   * Attaches an error to the current error scope (created by {@link GPUDevice.pushErrorScope}).
   * If there is no error scope, it reports the error as a `'uncapturederror'`
   */
  injectError(type: GPUErrorFilter, error: Promise<GPUError | null>): void;
}

/**
 * Creates {@link WeslDevice} for usage with WESL.
 * Does not impact your existing code, wherever a {@link GPUDevice} can be used,
 * a {@link WeslDevice} is also valid.
 *
 * WESL uses a {@link WeslDevice} to display errors referencing the WESL source
 * instead of referencing the generated WGSL code.
 */
export async function requestWeslDevice(
  adapter: GPUAdapter | null,
  descriptor?: GPUDeviceDescriptor,
): Promise<WeslDevice> {
  if (!adapter) {
    throw new Error("No GPU adapter");
  }
  return adapter.requestDevice(descriptor).then(makeWeslDevice);
}

/**
 * Mutates a {@link GPUDevice} for usage with WESL.
 * Does not impact your existing code, wherever a {@link GPUDevice} can be used,
 * a {@link WeslDevice} is also valid.
 *
 * WESL uses a {@link WeslDevice} to display errors referencing the WESL source
 * instead of referencing the generated WGSL code.
 */
export function makeWeslDevice(device: GPUDevice): WeslDevice {
  const errorScopeStack: ErrorScope[] = [];

  (device as WeslDevice).injectError = (type, error) => {
    const errorScope = errorScopeStack.findLast(v => v.filter === type);
    if (errorScope !== undefined) {
      errorScope.errors.push(error);
    } else {
      error.then(e => {
        if (e !== null) {
          dispatchError(e);
        }
      });
    }
  };

  function dispatchError(e: GPUError) {
    // If there's no scope, we throw an error through the WebGPU facilities
    // Only dispatching an error doesn't result in a browser log message, so we implement that ourselves
    // We also make sure to first go through the normal "uncapturederror" process. Since this is the last `addEventListener`, it will get called at the very end.
    device.addEventListener(
      "uncapturederror",
      ev => {
        if (!ev.defaultPrevented) {
          if ("compilationInfo" in ev.error) {
            const error = ev.error as ExtendedGPUValidationError;
            // A custom mode with clickable sources. Uses https://stackoverflow.com/a/79467192/3492994
            if (error.compilationInfo) {
              for (const message of error.compilationInfo.messages) {
                throwClickableError({
                  url: message.module.url,
                  text: message.module.text ?? null,
                  lineNumber: message.lineNum,
                  lineColumn: message.linePos,
                  length: message.length,
                  offset: message.offset,
                  error: new Error(message.type + ": " + message.message),
                });
              }
            } else {
              console.error(ev.error.message);
            }
          } else {
            console.error(ev.error.message);
          }
        }
      },
      {
        // This event listener should only happen for this event!
        once: true,
      },
    );
    device.dispatchEvent(
      new GPUUncapturedErrorEvent("uncapturederror", { error: e }),
    );
  }

  // Keep track of the error scopes so that we can inject our errors into them
  // Based on https://jsgist.org/?src=e3fb4659a668e00c69b03c82ec8f0ad1 from @greggman
  device.pushErrorScope = ((
    baseFn: GPUDevice["pushErrorScope"],
  ): GPUDevice["pushErrorScope"] => {
    return function (this: GPUDevice, filter: GPUErrorFilter) {
      errorScopeStack.push({
        filter,
        errors: [],
      });
      return baseFn.call(this, filter);
    };
  })(device.pushErrorScope);

  device.popErrorScope = ((
    baseFn: GPUDevice["popErrorScope"],
  ): GPUDevice["popErrorScope"] => {
    return function (this: GPUDevice) {
      // Get our custom error scope stack
      const errorScope = errorScopeStack.pop();
      if (errorScope === undefined) {
        // This can also happen when makeWeslDevice was called after a `pushErrorScope`
        throw new DOMException(
          "popErrorScope called on empty error scope stack",
          "OperationError",
        );
      }
      // Add the real error reporter
      errorScope.errors.push(baseFn.call(this));
      // And get the first error (not null)
      // LATER consider reporting *all* errors, and not just the first
      const errorPromise = Promise.all(errorScope.errors).then(
        values => values.find(v => v !== null) ?? null,
      );
      return errorPromise;
    };
  })(device.popErrorScope);

  return device as WeslDevice;
}
