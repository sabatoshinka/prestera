// Window capture -> D3D11 shared NT textures. No JPEG encoding.
#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <d3dcompiler.h>
#include <dwmapi.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Metadata.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <winrt/Windows.Security.Authorization.AppCapabilityAccess.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <sstream>
#include <thread>
#include <vector>
using namespace winrt;
using namespace winrt::Windows::Graphics::Capture;
using namespace winrt::Windows::Graphics::DirectX;
using namespace winrt::Windows::Graphics::DirectX::Direct3D11;
using Clock = std::chrono::steady_clock;
static HANDLE parentProcess = nullptr;
static void closeRemote(HANDLE value) {
  if (!value) return;
  HANDLE local = nullptr;
  if (DuplicateHandle(parentProcess, value, GetCurrentProcess(), &local, 0, FALSE,
      DUPLICATE_SAME_ACCESS | DUPLICATE_CLOSE_SOURCE)) CloseHandle(local);
}
struct Frame {
  com_ptr<ID3D11Texture2D> texture; HANDLE remote = nullptr;
  Frame() = default;
  Frame(Frame&& other) noexcept : texture(std::move(other.texture)), remote(std::exchange(other.remote, nullptr)) {}
  Frame(const Frame&) = delete;
  ~Frame() { closeRemote(remote); }
};
struct Commands {
  std::atomic<bool> running{true};
  std::mutex mutex;
  std::vector<std::pair<char, unsigned long long>> pending;
};
struct WindowBitmap {
  HDC dc = CreateCompatibleDC(nullptr);
  HBITMAP bitmap = nullptr;
  HGDIOBJ previous = nullptr;
  void* pixels = nullptr;
  int width = 0, height = 0;
  ~WindowBitmap() { if (previous) SelectObject(dc, previous); if (bitmap) DeleteObject(bitmap); if (dc) DeleteDC(dc); }
  void resize(int w, int h) {
    if (w == width && h == height) return;
    if (previous) SelectObject(dc, previous);
    if (bitmap) DeleteObject(bitmap);
    bitmap = nullptr; previous = nullptr;
    BITMAPINFO info{}; info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = w; info.bmiHeader.biHeight = -h;
    info.bmiHeader.biPlanes = 1; info.bmiHeader.biBitCount = 32; info.bmiHeader.biCompression = BI_RGB;
    bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &pixels, nullptr, 0);
    if (!dc || !bitmap) throw hresult_error(E_OUTOFMEMORY);
    previous = SelectObject(dc, bitmap); width = w; height = h;
  }
};
int wmain(int argc, wchar_t** argv) {
  if (argc != 8) return 2;
  try {
    init_apartment(apartment_type::multi_threaded);
    SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    HWND window = reinterpret_cast<HWND>(std::stoull(argv[1]));
    int maxWidth = std::clamp(std::stoi(argv[2]), 320, 1920);
    int maxHeight = std::clamp(std::stoi(argv[3]), 240, 1080);
    int fps = std::clamp(std::stoi(argv[4]), 1, 60);
    parentProcess = OpenProcess(PROCESS_DUP_HANDLE | SYNCHRONIZE, FALSE, std::stoul(argv[5]));
    if (!parentProcess || !IsWindow(window)) return 3;
    bool border = std::stoi(argv[6]) != 0;
    wchar_t windowClass[256]{};
    GetClassNameW(window, windowClass, 256);
    const bool chromium = std::wstring(windowClass).rfind(L"Chrome_WidgetWin_", 0) == 0;
    // Chromium's redirection surface can contain only an opaque window backdrop.
    // It passes an empty-pixel probe but omits the DirectComposition web content.
    // Request the complete client composition instead; never read desktop pixels.
    const bool dwm = std::wstring(argv[7]) == L"dwm" && !chromium;
    const bool gdi = std::wstring(argv[7]) == L"gdi" || (chromium && std::wstring(argv[7]) == L"dwm");
    // DWM's shared surface API is dynamically resolved; unsupported windows fail
    // explicitly rather than silently falling back to a bordered WGC session.
    using DwmSurface = BOOL (WINAPI*)(HWND, HANDLE*, LUID*, ULONG*, ULONG*, ULONGLONG*);
    auto surfaceForWindow = reinterpret_cast<DwmSurface>(GetProcAddress(GetModuleHandleW(L"user32.dll"), "DwmGetDxSharedSurface"));
    com_ptr<IDXGIAdapter1> adapter;
    if (dwm) {
      DWORD affinity = 0;
      if (!GetWindowDisplayAffinity(window, &affinity) || affinity != WDA_NONE) throw hresult_error(E_ACCESSDENIED);
      HANDLE handle = nullptr; LUID luid{}; ULONG format = 0, flags = 0; ULONGLONG update = 0;
      if (!surfaceForWindow || !surfaceForWindow(window, &handle, &luid, &format, &flags, &update) || !handle) throw hresult_error(E_NOTIMPL);
      com_ptr<IDXGIFactory1> factory;
      check_hresult(CreateDXGIFactory1(guid_of<IDXGIFactory1>(), factory.put_void()));
      for (UINT index = 0; ; ++index) {
        com_ptr<IDXGIAdapter1> candidate;
        if (factory->EnumAdapters1(index, candidate.put()) == DXGI_ERROR_NOT_FOUND) break;
        DXGI_ADAPTER_DESC1 desc{}; check_hresult(candidate->GetDesc1(&desc));
        if (desc.AdapterLuid.HighPart == luid.HighPart && desc.AdapterLuid.LowPart == luid.LowPart) { adapter = candidate; break; }
      }
      if (!adapter) throw hresult_error(DXGI_ERROR_NOT_FOUND);
    }
    com_ptr<ID3D11Device> device;
    com_ptr<ID3D11DeviceContext> context;
    check_hresult(D3D11CreateDevice(adapter.get(), adapter ? D3D_DRIVER_TYPE_UNKNOWN : D3D_DRIVER_TYPE_HARDWARE, nullptr,
      D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0, D3D11_SDK_VERSION, device.put(), nullptr, context.put()));
    auto dxgi = device.as<IDXGIDevice>();
    com_ptr<IInspectable> inspectable;
    check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgi.get(), inspectable.put()));
    auto directDevice = inspectable.as<IDirect3DDevice>();
    GraphicsCaptureItem item{nullptr};
    winrt::Windows::Graphics::SizeInt32 size{};
    Direct3D11CaptureFramePool pool{nullptr};
    GraphicsCaptureSession session{nullptr};
    bool borderless = dwm || gdi;
    if (!dwm && !gdi) {
      auto factory = get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
      check_hresult(factory->CreateForWindow(window, guid_of<GraphicsCaptureItem>(), put_abi(item)));
      size = item.Size();
      pool = Direct3D11CaptureFramePool::CreateFreeThreaded(directDevice, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size);
      session = pool.CreateCaptureSession(item);
    }
    if (!dwm && !gdi && !border && winrt::Windows::Foundation::Metadata::ApiInformation::IsPropertyPresent(
      L"Windows.Graphics.Capture.GraphicsCaptureSession", L"IsBorderRequired")) {
      try {
        const auto access = GraphicsCaptureAccess::RequestAccessAsync(GraphicsCaptureAccessKind::Borderless).get();
        if (access == winrt::Windows::Security::Authorization::AppCapabilityAccess::AppCapabilityAccessStatus::Allowed) {
          session.IsBorderRequired(false);
          borderless = true;
        }
      } catch (...) { /* Strict mode fails below; never start a bordered session. */ }
    }
    if (!border && !borderless) throw hresult_error(E_ACCESSDENIED);
    // A single fullscreen triangle scales entirely on the GPU.
    const char* shader = R"(
      Texture2D source : register(t0); SamplerState filterSampler : register(s0);
      struct V { float4 pos : SV_Position; float2 uv : TEXCOORD0; };
      V vs(uint id : SV_VertexID) { V o; o.uv=float2((id<<1)&2,id&2); o.pos=float4(o.uv*float2(2,-2)+float2(-1,1),0,1); return o; }
      float4 ps(V i) : SV_Target { return float4(source.Sample(filterSampler,i.uv).rgb,1); }
    )";
    com_ptr<ID3DBlob> vsBytes, psBytes, errors;
    check_hresult(D3DCompile(shader, strlen(shader), nullptr, nullptr, nullptr, "vs", "vs_4_0", 0, 0, vsBytes.put(), errors.put()));
    errors = nullptr;
    check_hresult(D3DCompile(shader, strlen(shader), nullptr, nullptr, nullptr, "ps", "ps_4_0", 0, 0, psBytes.put(), errors.put()));
    com_ptr<ID3D11VertexShader> vs; com_ptr<ID3D11PixelShader> ps;
    check_hresult(device->CreateVertexShader(vsBytes->GetBufferPointer(), vsBytes->GetBufferSize(), nullptr, vs.put()));
    check_hresult(device->CreatePixelShader(psBytes->GetBufferPointer(), psBytes->GetBufferSize(), nullptr, ps.put()));
    D3D11_SAMPLER_DESC sd{}; sd.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
    sd.AddressU = sd.AddressV = sd.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP; sd.MaxLOD = D3D11_FLOAT32_MAX;
    com_ptr<ID3D11SamplerState> sampler; check_hresult(device->CreateSamplerState(&sd, sampler.put()));
    auto commandState = std::make_shared<Commands>();
    auto& running = commandState->running;
    auto& commandsMutex = commandState->mutex;
    auto& commands = commandState->pending;
    std::thread input([commandState] {
      std::string line;
      while (std::getline(std::cin, line)) {
        if (line == "stop") break;
        std::istringstream command(line); char op; unsigned long long id;
        if (command >> op >> id) { std::lock_guard lock(commandState->mutex); commandState->pending.emplace_back(op, id); }
      }
      commandState->running = false;
    });
    // The process owns stdin; do not wait for a pipe read when capture ends itself.
    input.detach();
    if (session) session.StartCapture();
    std::cout << "{\"type\":\"ready\",\"backend\":\"" << (gdi ? "GDI" : dwm ? "DWM" : "WGC") << "\",\"borderless\":" << (borderless ? "true" : "false") << "}" << std::endl;
    std::map<unsigned long long, Frame> frames;
    unsigned long long sequence = 0;
    com_ptr<ID3D11Texture2D> sourceCopy; com_ptr<ID3D11ShaderResourceView> sourceView;
    int sourceWidth = 0, sourceHeight = 0;
    DXGI_FORMAT sourceFormat = DXGI_FORMAT_UNKNOWN;
    WindowBitmap bitmap;
    int emptySurfaces = 0;
    auto next = Clock::now();
    while (running && IsWindow(window) && WaitForSingleObject(parentProcess, 0) == WAIT_TIMEOUT) {
      { std::lock_guard lock(commandsMutex);
        for (auto [op, id] : commands) {
          auto found = frames.find(id);
          if (found == frames.end()) continue;
          closeRemote(found->second.remote); found->second.remote = nullptr;
          if (op == 'r') frames.erase(found);
        }
        commands.clear();
      }
      const auto now = Clock::now();
      if (frames.size() >= 6 || now < next) { Sleep(1); continue; }
      if (IsIconic(window)) { Sleep(40); continue; }
      Direct3D11CaptureFrame frame{nullptr};
      winrt::Windows::Graphics::SizeInt32 content{};
      com_ptr<ID3D11Texture2D> source;
      if (gdi) {
        DWORD affinity = 0; RECT rect{};
        if (!GetWindowDisplayAffinity(window, &affinity) || affinity != WDA_NONE) throw hresult_error(E_ACCESSDENIED);
        if (!(chromium ? GetClientRect(window, &rect) : GetWindowRect(window, &rect))) throw hresult_error(E_FAIL);
        content = {rect.right - rect.left, rect.bottom - rect.top};
        if (content.Width <= 0 || content.Height <= 0 || content.Width > 16384 || content.Height > 16384 || int64_t(content.Width) * content.Height > 40000000) throw hresult_error(E_INVALIDARG);
        bitmap.resize(content.Width, content.Height);
        memset(bitmap.pixels, 0, size_t(content.Width) * content.Height * 4);
        if (!PrintWindow(window, bitmap.dc, 2 /* PW_RENDERFULLCONTENT */ | (chromium ? PW_CLIENTONLY : 0))) throw hresult_error(E_NOTIMPL);
        GdiFlush();
        const auto pixels = static_cast<const uint32_t*>(bitmap.pixels);
        if (std::all_of(pixels, pixels + size_t(content.Width) * content.Height, [](uint32_t pixel) { return (pixel & 0x00ffffff) == 0; })) {
          // Classic windows may implement WM_PRINT but expose no DWM content.
          if (!PrintWindow(window, bitmap.dc, chromium ? PW_CLIENTONLY : 0)) throw hresult_error(E_NOTIMPL);
          GdiFlush();
          if (std::all_of(pixels, pixels + size_t(content.Width) * content.Height, [](uint32_t pixel) { return (pixel & 0x00ffffff) == 0; })) {
            DWORD_PTR result = 0;
            if (!SendMessageTimeoutW(window, chromium ? WM_PRINTCLIENT : WM_PRINT, reinterpret_cast<WPARAM>(bitmap.dc), PRF_CLIENT | (chromium ? 0 : PRF_NONCLIENT) | PRF_CHILDREN | PRF_ERASEBKGND,
                SMTO_ABORTIFHUNG | SMTO_BLOCK, 1000, &result)) throw hresult_error(E_NOTIMPL);
            GdiFlush();
          }
        }
      } else if (dwm) {
        DWORD affinity = 0;
        if (!GetWindowDisplayAffinity(window, &affinity) || affinity != WDA_NONE) throw hresult_error(E_ACCESSDENIED);
        HANDLE handle = nullptr; LUID luid{}; ULONG format = 0, flags = 0; ULONGLONG update = 0;
        DwmFlush();
        if (!surfaceForWindow(window, &handle, &luid, &format, &flags, &update) || !handle) throw hresult_error(E_NOTIMPL);
        // This is a legacy DXGI shared-resource handle owned by DWM. Never close it
        // or import it into Electron. Copy into our own NT texture below instead.
        check_hresult(device->OpenSharedResource(handle, guid_of<ID3D11Texture2D>(), source.put_void()));
        D3D11_TEXTURE2D_DESC description{}; source->GetDesc(&description);
        content = {static_cast<int>(description.Width), static_cast<int>(description.Height)};
      } else {
        frame = pool.TryGetNextFrame();
        if (!frame) { Sleep(2); continue; }
        content = frame.ContentSize();
        if (content.Width != size.Width || content.Height != size.Height) {
          size = content; frame.Close();
          if (size.Width > 0 && size.Height > 0) pool.Recreate(directDevice, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size);
          continue;
        }
        check_hresult(frame.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>()->GetInterface(guid_of<ID3D11Texture2D>(), source.put_void()));
      }
      if (content.Width < 2 || content.Height < 2) { if (frame) frame.Close(); continue; }
      next = now + std::chrono::microseconds(1000000 / fps);
      if (content.Width > 16384 || content.Height > 16384 || int64_t(content.Width) * content.Height > 40000000) throw hresult_error(E_INVALIDARG);
      D3D11_TEXTURE2D_DESC desc{};
      if (source) source->GetDesc(&desc);
      else { desc.Width = content.Width; desc.Height = content.Height; desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM; }
      auto format = desc.Format;
      if (format == DXGI_FORMAT_B8G8R8A8_TYPELESS) format = DXGI_FORMAT_B8G8R8A8_UNORM;
      if (format == DXGI_FORMAT_R8G8B8A8_TYPELESS) format = DXGI_FORMAT_R8G8B8A8_UNORM;
      if (format != DXGI_FORMAT_B8G8R8A8_UNORM && format != DXGI_FORMAT_R8G8B8A8_UNORM && format != DXGI_FORMAT_B8G8R8X8_UNORM) throw hresult_error(E_NOTIMPL);
      if (!sourceCopy || sourceWidth != content.Width || sourceHeight != content.Height || sourceFormat != format) {
        sourceWidth = content.Width; sourceHeight = content.Height;
        sourceFormat = format;
        sourceView = nullptr; sourceCopy = nullptr;
        D3D11_TEXTURE2D_DESC copy{}; copy.Width = sourceWidth; copy.Height = sourceHeight;
        copy.MipLevels = copy.ArraySize = 1; copy.Format = format;
        copy.SampleDesc.Count = 1; copy.Usage = D3D11_USAGE_DEFAULT; copy.BindFlags = D3D11_BIND_SHADER_RESOURCE;
        check_hresult(device->CreateTexture2D(&copy, nullptr, sourceCopy.put()));
        check_hresult(device->CreateShaderResourceView(sourceCopy.get(), nullptr, sourceView.put()));
      }
      D3D11_BOX region{0, 0, 0, static_cast<UINT>(std::min(content.Width, static_cast<int>(desc.Width))), static_cast<UINT>(std::min(content.Height, static_cast<int>(desc.Height))), 1};
      if (gdi) context->UpdateSubresource(sourceCopy.get(), 0, nullptr, bitmap.pixels, content.Width * 4, 0);
      else context->CopySubresourceRegion(sourceCopy.get(), 0, 0, 0, 0, source.get(), 0, &region);
      // Some DWM surfaces are allocated but never populated on recent Windows.
      // Probe a tiny central patch only during startup, including alpha, so an
      // opaque black frame remains valid. Do not stream an empty surface forever.
      if (dwm && sequence == 0) {
        D3D11_TEXTURE2D_DESC probe{}; probe.Width = probe.Height = 2; probe.MipLevels = probe.ArraySize = 1;
        probe.Format = format; probe.SampleDesc.Count = 1; probe.Usage = D3D11_USAGE_STAGING; probe.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
        com_ptr<ID3D11Texture2D> staging; check_hresult(device->CreateTexture2D(&probe, nullptr, staging.put()));
        const UINT x = std::max(0, content.Width / 2 - 1), y = std::max(0, content.Height / 2 - 1);
        D3D11_BOX patch{x, y, 0, x + 2, y + 2, 1};
        context->CopySubresourceRegion(staging.get(), 0, 0, 0, 0, sourceCopy.get(), 0, &patch);
        D3D11_MAPPED_SUBRESOURCE mapped{}; check_hresult(context->Map(staging.get(), 0, D3D11_MAP_READ, 0, &mapped));
        bool populated = false;
        for (UINT row = 0; row < 2; ++row) for (UINT col = 0; col < 8; ++col)
          populated |= static_cast<unsigned char*>(mapped.pData)[row * mapped.RowPitch + col] != 0;
        context->Unmap(staging.get(), 0);
        if (!populated) { if (++emptySurfaces >= 8) throw hresult_error(E_NOTIMPL); Sleep(30); continue; }
      }
      const double scale = std::min({1.0, double(maxWidth) / content.Width, double(maxHeight) / content.Height});
      const int width = std::max(2, int(content.Width * scale) & ~1), height = std::max(2, int(content.Height * scale) & ~1);
      D3D11_TEXTURE2D_DESC target{}; target.Width = width; target.Height = height;
      target.MipLevels = target.ArraySize = 1; target.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
      target.SampleDesc.Count = 1; target.Usage = D3D11_USAGE_DEFAULT;
      target.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
      target.MiscFlags = D3D11_RESOURCE_MISC_SHARED_NTHANDLE | D3D11_RESOURCE_MISC_SHARED;
      Frame out; check_hresult(device->CreateTexture2D(&target, nullptr, out.texture.put()));
      com_ptr<ID3D11RenderTargetView> rtv; check_hresult(device->CreateRenderTargetView(out.texture.get(), nullptr, rtv.put()));
      auto rt = rtv.get(); context->OMSetRenderTargets(1, &rt, nullptr);
      D3D11_VIEWPORT viewport{0, 0, float(width), float(height), 0, 1}; context->RSSetViewports(1, &viewport);
      context->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
      context->VSSetShader(vs.get(), nullptr, 0); context->PSSetShader(ps.get(), nullptr, 0);
      auto srv = sourceView.get(); context->PSSetShaderResources(0, 1, &srv);
      auto sample = sampler.get(); context->PSSetSamplers(0, 1, &sample); context->Draw(3, 0);
      srv = nullptr; context->PSSetShaderResources(0, 1, &srv); context->OMSetRenderTargets(0, nullptr, nullptr);
      // Finish the producer's GPU commands before exposing the texture to Chromium.
      D3D11_QUERY_DESC qd{D3D11_QUERY_EVENT, 0}; com_ptr<ID3D11Query> query;
      check_hresult(device->CreateQuery(&qd, query.put())); context->End(query.get()); context->Flush();
      const auto deadline = Clock::now() + std::chrono::seconds(2);
      HRESULT status;
      while ((status = context->GetData(query.get(), nullptr, 0, 0)) == S_FALSE && running && Clock::now() < deadline) Sleep(1);
      if (status != S_OK) throw hresult_error(E_FAIL);
      HANDLE local = nullptr;
      check_hresult(out.texture.as<IDXGIResource1>()->CreateSharedHandle(nullptr, DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE, nullptr, &local));
      const BOOL duplicated = DuplicateHandle(GetCurrentProcess(), local, parentProcess, &out.remote, 0, FALSE, DUPLICATE_SAME_ACCESS);
      CloseHandle(local); if (!duplicated) throw hresult_error(E_FAIL);
      const auto timestamp = std::chrono::duration_cast<std::chrono::microseconds>(now.time_since_epoch()).count();
      const auto id = ++sequence; const auto handle = reinterpret_cast<uintptr_t>(out.remote);
      frames.emplace(id, std::move(out));
      std::cout << "{\"type\":\"frame\",\"seq\":" << id << ",\"handle\":\"" << handle << "\",\"width\":" << width << ",\"height\":" << height << ",\"timestamp\":" << timestamp << "}" << std::endl;
      if (frame) frame.Close();
    }
    if (session) session.Close();
    if (pool) pool.Close();
    frames.clear();
    CloseHandle(parentProcess);
    // stdin thread may still be blocked; exit without unwinding its shared state.
    ExitProcess(0);
  } catch (const hresult_error& e) {
    std::cerr << "GPU capture error 0x" << std::hex << uint32_t(e.code()) << std::endl;
    ExitProcess(1);
  } catch (...) { ExitProcess(2); }
}
