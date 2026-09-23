#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <wrl.h>
#include <wrl/implements.h>
#include <cstdio>
#include <cstdlib>
#include <fcntl.h>
#include <io.h>
#include <vector>
#include <cstdint>
#include <cmath>
#include <mmsystem.h>

using namespace Microsoft::WRL;
class Activation final : public RuntimeClass<RuntimeClassFlags<ClassicCom>, IActivateAudioInterfaceCompletionHandler, FtmBase> {
public:
    HANDLE done = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    HRESULT result = E_FAIL;
    ComPtr<IAudioClient> client;
    ~Activation() { CloseHandle(done); }
    STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* operation) override {
        ComPtr<IUnknown> unknown;
        HRESULT hr = operation->GetActivateResult(&result, &unknown);
        if (FAILED(hr)) result = hr;
        if (SUCCEEDED(result) && unknown) result = unknown.As(&client);
        SetEvent(done);
        return S_OK;
    }
};
int fail(const char* step, HRESULT hr) {
    fprintf(stderr, "ERROR %s 0x%08lX\n", step, static_cast<unsigned long>(hr));
    return 1;
}
int wmain(int argc, wchar_t** argv) {
    if (argc < 3) return fail("usage: --window HWND | --pid PID | --probe PID", E_INVALIDARG);
    if (wcscmp(argv[1], L"--background-window") == 0) {
        auto handle = reinterpret_cast<HWND>(static_cast<uintptr_t>(_wcstoui64(argv[2], nullptr, 10)));
        return SetWindowPos(handle, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) ? 0 : 1;
    }
    if (wcscmp(argv[1], L"--test-tone") == 0) {
        const double frequency = _wtof(argv[2]);
        WAVEFORMATEX format = { WAVE_FORMAT_PCM, 2, 48000, 192000, 4, 16, 0 };
        HWAVEOUT output = nullptr;
        if (waveOutOpen(&output, WAVE_MAPPER, &format, 0, 0, CALLBACK_NULL)) return 2;
        const size_t frames = 48000 * 6;
        std::vector<short> samples(frames * 2);
        for (size_t i = 0; i < frames; i++) samples[i * 2] = samples[i * 2 + 1] = static_cast<short>(std::sin(i * 6.283185307179586 * frequency / 48000) * 1500);
        WAVEHDR header = {}; header.lpData = reinterpret_cast<LPSTR>(samples.data()); header.dwBufferLength = static_cast<DWORD>(samples.size() * sizeof(short));
        waveOutPrepareHeader(output, &header, sizeof(header));
        fprintf(stderr, "TONE_READY %lu\n", GetCurrentProcessId()); fflush(stderr);
        Sleep(500); waveOutWrite(output, &header, sizeof(header));
        while (!(header.dwFlags & WHDR_DONE)) Sleep(10);
        waveOutUnprepareHeader(output, &header, sizeof(header)); waveOutClose(output); return 0;
    }
    DWORD pid = 0;
    if (wcscmp(argv[1], L"--window") == 0) {
        auto handle = reinterpret_cast<HWND>(static_cast<uintptr_t>(_wcstoui64(argv[2], nullptr, 10)));
        if (!IsWindow(handle)) return fail("window_closed", E_INVALIDARG);
        GetWindowThreadProcessId(handle, &pid);
    } else pid = wcstoul(argv[2], nullptr, 10);
    if (!pid) return fail("invalid_process", E_INVALIDARG);
    const HRESULT init = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(init)) return fail("COM", init);
    AUDIOCLIENT_ACTIVATION_PARAMS parameters = {};
    parameters.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    parameters.ProcessLoopbackParams.TargetProcessId = pid;
    parameters.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
    PROPVARIANT variant = {};
    variant.vt = VT_BLOB;
    variant.blob.cbSize = sizeof(parameters);
    variant.blob.pBlobData = reinterpret_cast<BYTE*>(&parameters);
    auto activation = Make<Activation>();
    ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
    HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &variant, activation.Get(), &operation);
    if (FAILED(hr)) return fail("activate", hr);
    if (WaitForSingleObject(activation->done, 8000) != WAIT_OBJECT_0) return fail("activation_timeout", E_FAIL);
    if (FAILED(activation->result)) return fail("process_loopback_unavailable", activation->result);
    WAVEFORMATEX format = {};
    format.wFormatTag = WAVE_FORMAT_PCM;
    format.nChannels = 2; format.nSamplesPerSec = 48000; format.wBitsPerSample = 16;
    format.nBlockAlign = 4; format.nAvgBytesPerSec = 192000;
    hr = activation->client->Initialize(AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
        200000, 0, &format, nullptr);
    if (FAILED(hr)) return fail("initialize", hr);
    HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    hr = activation->client->SetEventHandle(ready);
    if (FAILED(hr)) return fail("event", hr);
    ComPtr<IAudioCaptureClient> capture;
    hr = activation->client->GetService(IID_PPV_ARGS(&capture));
    if (FAILED(hr)) return fail("capture_service", hr);
    if (wcscmp(argv[1], L"--probe") == 0) { fprintf(stderr, "READY\n"); CloseHandle(ready); return 0; }
    _setmode(_fileno(stdout), _O_BINARY);
    setvbuf(stdout, nullptr, _IONBF, 0);
    hr = activation->client->Start();
    if (FAILED(hr)) return fail("start", hr);
    fprintf(stderr, "READY %lu 48000 2 s16le\n", pid); fflush(stderr);
    bool running = true;
    while (running) {
        if (WaitForSingleObject(ready, 2000) == WAIT_FAILED) break;
        UINT32 frames = 0;
        while (SUCCEEDED(capture->GetNextPacketSize(&frames)) && frames) {
            BYTE* data = nullptr; DWORD flags = 0;
            hr = capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
            if (FAILED(hr)) { running = false; break; }
            const size_t bytes = static_cast<size_t>(frames) * format.nBlockAlign;
            std::vector<BYTE> silence;
            if (flags & AUDCLNT_BUFFERFLAGS_SILENT) { silence.resize(bytes); data = silence.data(); }
            const size_t written = fwrite(data, 1, bytes, stdout);
            capture->ReleaseBuffer(frames);
            if (written != bytes) { running = false; break; }
        }
    }
    activation->client->Stop(); CloseHandle(ready);
    return 0;
}
