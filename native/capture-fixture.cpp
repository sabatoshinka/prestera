// Test-only source window: an 80px color swatch, never user content.
#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <iostream>
static ID3D11DeviceContext* context;
static IDXGISwapChain* swap;
static ID3D11RenderTargetView* target;
void Render() {
  if (!target) return;
  const float color[] = {30.f/255, 90.f/255, 150.f/255, 1};
  context->ClearRenderTargetView(target, color); swap->Present(1, 0);
}
LRESULT CALLBACK Paint(HWND window, UINT message, WPARAM w, LPARAM l) {
  if (message == WM_PRINTCLIENT || message == WM_PRINT) {
    RECT rect; GetClientRect(window, &rect);
    HBRUSH brush = CreateSolidBrush(RGB(30, 90, 150)); FillRect(reinterpret_cast<HDC>(w), &rect, brush); DeleteObject(brush);
    return 0;
  }
  if (message == WM_PAINT) {
    PAINTSTRUCT paint; HDC dc = BeginPaint(window, &paint);
    RECT rect; GetClientRect(window, &rect);
    HBRUSH brush = CreateSolidBrush(RGB(30, 90, 150)); FillRect(dc, &rect, brush); DeleteObject(brush);
    EndPaint(window, &paint); return 0;
  }
  if (message == WM_TIMER) { Render(); return 0; }
  if (message == WM_DESTROY) { PostQuitMessage(0); return 0; }
  return DefWindowProcW(window, message, w, l);
}
int main() {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  WNDCLASSW cls{}; cls.lpfnWndProc = Paint; cls.hInstance = GetModuleHandleW(nullptr); cls.lpszClassName = L"PresteraSyntheticCapture";
  RegisterClassW(&cls);
  const int x = GetSystemMetrics(SM_XVIRTUALSCREEN) + 2;
  HWND window = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, cls.lpszClassName, L"Prestera synthetic capture", WS_POPUP,
    x, GetSystemMetrics(SM_YVIRTUALSCREEN) + 2, 80, 80, nullptr, nullptr, cls.hInstance, nullptr);
  if (!window) return 1;
  // The launcher hides the console using STARTF_USESHOWWINDOW, which overrides
  // the first ShowWindow call as well. Show only this non-activating test swatch.
  ShowWindow(window, SW_SHOWNOACTIVATE);
  ShowWindow(window, SW_SHOWNOACTIVATE); UpdateWindow(window);
  DXGI_SWAP_CHAIN_DESC desc{}; desc.BufferDesc.Width = desc.BufferDesc.Height = 80;
  desc.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM; desc.SampleDesc.Count = 1;
  desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT; desc.BufferCount = 2;
  desc.OutputWindow = window; desc.Windowed = TRUE; desc.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;
  ID3D11Device* device;
  if (FAILED(D3D11CreateDeviceAndSwapChain(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0, nullptr, 0,
      D3D11_SDK_VERSION, &desc, &swap, &device, nullptr, &context))) return 2;
  ID3D11Texture2D* buffer;
  if (FAILED(swap->GetBuffer(0, __uuidof(ID3D11Texture2D), reinterpret_cast<void**>(&buffer)))) return 3;
  if (FAILED(device->CreateRenderTargetView(buffer, nullptr, &target))) return 4;
  buffer->Release(); Render();
  SetTimer(window, 1, 40, nullptr);
  std::cout << reinterpret_cast<uintptr_t>(window) << std::endl;
  MSG message;
  while (GetMessageW(&message, nullptr, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
}
