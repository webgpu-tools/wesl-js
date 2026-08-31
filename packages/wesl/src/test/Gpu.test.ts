import { setTimeout } from "node:timers";
import { expect, test, vi } from "vitest";
import { createShaderModule } from "../gpu/ShaderModule.ts";
import { makeWeslDevice } from "../gpu/WeslDevice.ts";
import { LinkedWesl } from "../LinkedWesl.ts";
import { SrcMap, SrcMapBuilder } from "../SrcMap.ts";

test("WeslDevice doesn't conflict with uncapturederror", async () => {
  const GPUDeviceMock = vi.fn(function (this: GPUDevice) {
    let errorListener: EventListener;
    this.createShaderModule = () => {
      const errorEvent: Partial<GPUUncapturedErrorEvent> = {
        error: {
          message: "shader compilation failed",
        },
        defaultPrevented: false,
      };
      errorListener(errorEvent as any);
      return {} as any;
    };
    this.pushErrorScope = () => {
      throw new Error("Should not be called");
    };
    this.popErrorScope = () => {
      throw new Error("Should not be called");
    };
    this.addEventListener = (type: string, listener: EventListener) => {
      expect(type).toBe("uncapturederror");

      errorListener = listener;
    };
  });
  const device = makeWeslDevice(new GPUDeviceMock() as any);

  const errorPromise = new Promise<GPUError>((resolve, reject) => {
    const TIMEOUT = setTimeout(() => {
      reject();
    }, 1000);
    device.addEventListener("uncapturederror", ev => {
      clearTimeout(TIMEOUT);
      resolve(ev.error);
    });
  });
  device.createShaderModule({
    code: "🐈",
  });

  const error = await errorPromise;

  expect(error.message).toBe("shader compilation failed");
});

test("WeslDevice doesn't conflict with popErrorsScope", async () => {
  const GPUDeviceMock = vi.fn(function (this: GPUDevice) {
    this.createShaderModule = () => {
      return {} as any;
    };
    this.pushErrorScope = () => {};
    this.popErrorScope = () => {
      return Promise.resolve({
        message: ":1:1 shader compilation failed",
      });
    };
  });
  const device = makeWeslDevice(new GPUDeviceMock() as any);
  const createShaderModuleSpy = vi.spyOn(device, "createShaderModule");
  device.pushErrorScope("validation");
  device.createShaderModule({
    code: "🐈",
  });
  const errorPromise = new Promise<GPUError | null>((resolve, reject) => {
    const TIMEOUT = setTimeout(() => {
      reject();
    }, 1000);
    device.popErrorScope().then(v => {
      clearTimeout(TIMEOUT);
      resolve(v);
    });
  });

  const error = await errorPromise;

  expect(error).not.toBe(null);
  expect(error?.message).toContain("shader compilation failed");
  expect(error?.message).toContain(":1:1");
  expect(createShaderModuleSpy).toHaveBeenCalledTimes(1);
});

test("LinkedWesl createShaderModule skips if it's not a WeslDevice", async () => {
  const GPUDeviceMock = vi.fn(function (this: GPUDevice) {
    this.createShaderModule = () => {
      return {} as any;
    };
    this.pushErrorScope = () => {
      throw new Error("Should not be called");
    };
    this.popErrorScope = () => {
      throw new Error("Should not be called");
    };
    this.addEventListener = () => {
      throw new Error("Should not be called");
    };
    this.createRenderPipeline = () => {
      return null as any;
    };
  });
  const device: GPUDevice = new GPUDeviceMock() as any;

  const createShaderModuleSpy = vi.spyOn(device, "createShaderModule");
  const linkedWesl = new LinkedWesl(
    new SrcMap({ text: "cute generated code" }),
  );

  // Test that this doesn't throw
  createShaderModule(linkedWesl, device, {});

  expect(createShaderModuleSpy).toHaveBeenCalledTimes(1);
});

test("Point at WESL code", async () => {
  const GPUValidationErrorMock = vi.fn(function (this: any, message: string) {
    this.message = message;
  });
  vi.stubGlobal("GPUValidationError", GPUValidationErrorMock);

  const GPUDeviceMock = vi.fn(function (this: GPUDevice) {
    this.createShaderModule = () => {
      return {
        getCompilationInfo(): Promise<GPUCompilationInfo> {
          return Promise.resolve({
            __brand: "GPUCompilationInfo",
            messages: [
              {
                __brand: "GPUCompilationMessage",
                type: "error",
                offset: 0,
                length: 4,
                lineNum: 1,
                linePos: 1,
                message: "shader compilation failed",
              },
            ],
          });
        },
      } as any;
    };
    this.pushErrorScope = () => {};
    this.popErrorScope = () => {
      return Promise.resolve({
        message: "this message gets ignored",
      });
    };
    this.dispatchEvent = () => {
      throw new Error("Should not be called");
    };
  });
  const device = makeWeslDevice(new GPUDeviceMock() as any);

  const source = { text: "\ncute source code", path: "main.wesl" };
  const builder = new SrcMapBuilder(source);
  // the fragments concatenate into the linked text "cute generated code"
  builder.add("cute gener", 1); // point at start of line 2
  builder.add("ated code", 8); // in-range tail anchor ("urce code")
  const linkedWesl = new LinkedWesl(SrcMapBuilder.build([builder]));

  device.pushErrorScope("validation");
  createShaderModule(linkedWesl, device, {});
  const result = await device.popErrorScope();

  // Expect that it's not the original, but instead the changed version
  expect(result?.message).not.toContain("this message gets ignored");
  expect(result?.message).not.toContain(":1:1");
  expect(result?.message).toContain(":2:1");
  expect(result?.message).toContain("shader compilation failed");

  vi.unstubAllGlobals();
});

test("Invokes error throwing", async () => {
  const GPUValidationErrorMock = vi.fn(function (this: any, message: string) {
    this.message = message;
  });
  vi.stubGlobal("GPUValidationError", GPUValidationErrorMock);
  const GPUUncapturedErrorEventMock = vi.fn(function (
    this: any,
    type: string,
    options: { error: GPUError },
  ) {
    this.type = type;
    this.error = options.error;
  });
  vi.stubGlobal("GPUUncapturedErrorEvent", GPUUncapturedErrorEventMock);

  const dispatchEventPromise = Promise.withResolvers();
  const dispatchEventTimer = setTimeout(() => {
    dispatchEventPromise.reject();
  }, 500);
  const GPUDeviceMock = vi.fn(function (this: GPUDevice) {
    this.createShaderModule = () => {
      return {
        getCompilationInfo(): Promise<GPUCompilationInfo> {
          return Promise.resolve({
            __brand: "GPUCompilationInfo",
            messages: [
              {
                __brand: "GPUCompilationMessage",
                type: "error",
                offset: 1,
                length: 4,
                lineNum: 1,
                linePos: 2,
                message: "shader compilation failed",
              },
            ],
          });
        },
      } as any;
    };
    this.pushErrorScope = () => {};
    this.popErrorScope = () => {
      return Promise.resolve({
        message: "this message gets ignored",
      });
    };
    this.addEventListener = () => {};
    this.dispatchEvent = () => {
      clearTimeout(dispatchEventTimer);
      dispatchEventPromise.resolve(true);
      return true;
    };
  });
  const device = makeWeslDevice(new GPUDeviceMock() as any);
  const dispatchEventSpy = vi.spyOn(device, "dispatchEvent");
  const injectErrorSpy = vi.spyOn(device, "injectError");

  const linkedWesl = new LinkedWesl(
    new SrcMap({
      text: "cute generated code",
    }),
  );

  createShaderModule(linkedWesl, device, {});

  expect(injectErrorSpy).toHaveBeenCalledTimes(1);

  await dispatchEventPromise.promise;
  expect(dispatchEventSpy).toHaveBeenCalledTimes(1);

  vi.unstubAllGlobals();
});

// LATER
// Test injecterror
// Test mapGPUCompilationInfo
