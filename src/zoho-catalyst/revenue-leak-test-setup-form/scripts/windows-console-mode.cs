using System;
using System.Globalization;
using System.Runtime.InteropServices;

// Local operator support only. Never read input, the clipboard, files or secrets.
// Numeric mode metadata is the entire stdout protocol; errors are exit codes.
internal static class WindowsConsoleMode
{
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetConsoleMode(IntPtr handle, out uint mode);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetConsoleMode(IntPtr handle, uint mode);

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length < 1) return 2;
            IntPtr input = GetStdHandle(-10);
            uint current;
            if (!GetConsoleMode(input, out current)) return 3;
            uint desired = current;
            if (args.Length == 1 && args[0] == "get")
            {
                Console.WriteLine(current.ToString(CultureInfo.InvariantCulture));
                return 0;
            }
            if (args.Length == 1 && args[0] == "enable")
            {
                // Conhost bypasses native Paste when VT input is enabled or
                // processed input is disabled. Echo and line input stay OFF.
                desired = (current | 0x0001u) & ~(0x0200u | 0x0004u | 0x0002u);
            }
            else if (args.Length != 2 || args[0] != "restore" ||
                !UInt32.TryParse(args[1], NumberStyles.None, CultureInfo.InvariantCulture, out desired))
            {
                return 2;
            }
            if (!SetConsoleMode(input, desired)) return 4;
            uint actual;
            if (!GetConsoleMode(input, out actual) || actual != desired) return 5;
            Console.WriteLine(actual.ToString(CultureInfo.InvariantCulture));
            return 0;
        }
        catch { return 6; }
    }
}
