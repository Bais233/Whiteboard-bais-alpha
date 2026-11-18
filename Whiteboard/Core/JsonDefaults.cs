using System.Text.Encodings.Web;
using System.Text.Json;

namespace Whiteboard.Core;

public static class JsonDefaults
{
    private static readonly JsonSerializerOptions CompactOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString,
        PropertyNameCaseInsensitive = true,
    };

    private static readonly JsonSerializerOptions IndentedOptions = new(CompactOptions)
    {
        WriteIndented = true,
    };

    public static JsonSerializerOptions Compact => CompactOptions;
    public static JsonSerializerOptions Indented => IndentedOptions;
}
