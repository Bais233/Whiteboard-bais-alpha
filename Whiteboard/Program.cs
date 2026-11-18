using System.Globalization;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using Whiteboard;
using Whiteboard.Core;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

builder.Services.AddSingleton<BoardState>();
builder.Services.AddSingleton<HistoryService>();
builder.Services.AddSingleton<StorageService>();
builder.Services.AddSingleton<RenderService>();
builder.Services.AddSingleton<ToolsService>();
builder.Services.AddSingleton<EditorService>();
builder.Services.AddSingleton<PlaybackService>();
builder.Services.AddSingleton<ExportService>();
builder.Services.AddSingleton<AppController>();

CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.InvariantCulture;

await builder.Build().RunAsync();
