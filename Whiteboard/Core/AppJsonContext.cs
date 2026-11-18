using System.Text.Json.Serialization;
using Whiteboard.Models;

namespace Whiteboard.Core;

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    PropertyNameCaseInsensitive = true,
    NumberHandling = JsonNumberHandling.AllowReadingFromString)]
[JsonSerializable(typeof(SceneDto))]
[JsonSerializable(typeof(DocumentDto))]
[JsonSerializable(typeof(List<Element>))]
[JsonSerializable(typeof(UiPrefsDto))]
[JsonSerializable(typeof(TextMeta))]
[JsonSerializable(typeof(TextMetricDto[]))]
public partial class AppJsonContext : JsonSerializerContext
{
}
