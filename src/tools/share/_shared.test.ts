import { describe, expect, it } from "vitest";
import {
  buildEditQuery,
  buildSmbQuery,
  emcmdCommand,
  isReservedName,
  parsePoolNames,
  parseReservedNames,
  parseShareCfg,
  validateShareName,
} from "./_shared.js";

const CFG = `# Generated settings:
shareComment="Docker application data"
shareInclude=""
shareUseCache="only"
shareCachePool="cache"
shareCachePool2=""
shareCOW="auto"
shareAllocator="highwater"
shareSplitLevel=""
shareFloor="50000000"
shareExport="-"
shareCaseSensitive="auto"
shareSecurity="public"
shareVolsizelimit=""
`;

describe("share config helpers", () => {
  it('parses key="value" lines and ignores comments', () => {
    const cfg = parseShareCfg(CFG);

    expect(cfg.shareComment).toBe("Docker application data");
    expect(cfg.shareUseCache).toBe("only");
    expect(cfg.shareInclude).toBe("");
    expect(Object.keys(cfg)).not.toContain("# Generated settings:");
  });

  it("builds the ShareEdit form body with changes overriding current values", () => {
    const query = buildEditQuery({
      name: "media",
      nameOrig: "media",
      current: parseShareCfg(CFG),
      changes: { comment: "Films & TV", useCache: "yes" },
      command: "Apply",
    });

    expect(query).toBe(
      "shareName=media&shareNameOrig=media&shareComment=Films%20%26%20TV&shareAllocator=highwater&shareFloor=50000000&shareSplitLevel=&shareUseCache=yes&shareCachePool=cache&shareCachePool2=&shareCOW=auto&shareInclude=&shareExclude=&cmdEditShare=Apply",
    );
  });

  it("uses Unraid defaults when creating from nothing", () => {
    const query = buildEditQuery({
      name: "new",
      nameOrig: "",
      current: {},
      changes: {},
      command: "Add Share",
    });

    expect(query).toContain("shareNameOrig=&");
    expect(query).toContain("shareAllocator=highwater");
    expect(query).toContain("shareUseCache=no");
    expect(query).toContain("shareCOW=auto");
    expect(query).toMatch(/cmdEditShare=Add%20Share$/);
  });

  it("builds the SecuritySMB form body only when an SMB field changes", () => {
    expect(buildSmbQuery("media", parseShareCfg(CFG), { comment: "x" })).toBeNull();
    expect(
      buildSmbQuery("media", parseShareCfg(CFG), { smbExport: "e", smbSecurity: "secure" }),
    ).toBe(
      "shareName=media&shareExport=e&shareSecurity=secure&shareCaseSensitive=auto&shareVolsizelimit=&changeShareSecurity=Apply",
    );
  });

  it("keeps the current export when only security changes", () => {
    expect(buildSmbQuery("media", parseShareCfg(CFG), { smbSecurity: "private" })).toContain(
      "shareExport=-&shareSecurity=private",
    );
  });

  it("wraps a query for emcmd with shell quoting", () => {
    expect(emcmdCommand("shareName=a&x=it's")).toBe(
      "'/usr/local/sbin/emcmd' 'shareName=a&x=it'\\''s'",
    );
  });

  it("extracts pool names (Cache sections) from disks.ini", () => {
    const ini =
      '["disk1"]\ntype="Data"\n["cache"]\ntype="Cache"\n["cache_downloads"]\ntype="Cache"\n["flash"]\ntype="Flash"\n';

    expect(parsePoolNames(ini)).toEqual(["cache", "cache_downloads"]);
  });

  it("reads reservedNames from var.ini", () => {
    expect(parseReservedNames('foo="1"\nreservedNames="flash,boot,user0"\n')).toEqual([
      "flash",
      "boot",
      "user0",
    ]);
    expect(parseReservedNames("")).toEqual([]);
  });

  it("checks reserved names case-insensitively, including the built-in list", () => {
    expect(isReservedName("Flash", [])).toBe(true);
    expect(isReservedName("cache", ["cache"])).toBe(true);
    expect(isReservedName("media", ["cache"])).toBe(false);
  });

  it("validates share names like the web UI", () => {
    expect(validateShareName("media")).toBeNull();
    expect(validateShareName("my share")).toMatch(/letters/);
    expect(validateShareName(".hidden")).toMatch(/dot/);
    expect(validateShareName("a".repeat(41))).toMatch(/40/);
    expect(validateShareName("")).not.toBeNull();
  });
});
