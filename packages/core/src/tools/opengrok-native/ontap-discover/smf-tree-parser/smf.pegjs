/**
 * SMF (Storage Management Framework) Grammar
 *
 * A complete PEG grammar for parsing ONTAP SMF schema files.
 * Generates an AST with full source location information.
 *
 * @author Generated for vsim-mcp project
 */

{{
  // Helper to merge locations
  function mergeLoc(start, end) {
    return {
      start: start.start,
      end: end.end
    };
  }

  // Flatten arrays and filter nulls
  function flatten(arr) {
    return arr.flat().filter(x => x != null);
  }

  // Parse field prefixes
  function parsePrefixes(prefixStr) {
    return {
      optional: (prefixStr || '').includes('!'),
      hidden: (prefixStr || '').includes('~'),
      noPositional: (prefixStr || '').includes('-')
    };
  }

  // Parse table attributes from token array (loc passed in)
  function parseAttributes(tokens, loc) {
    const attrs = { type: 'TableAttributes', loc: loc, rawTokens: [] };

    for (const token of tokens) {
      const t = typeof token === 'string' ? token.toLowerCase() : token;
      switch (t) {
        case 'create': attrs.create = true; break;
        case 'modify': attrs.modify = true; break;
        case 'automatic': attrs.automatic = true; break;
        case 'persistent': attrs.persistent = true; break;
        case 'replicated': attrs.replicated = true; break;
        case 'mdb': attrs.mdb = true; break;
        case 'deprecated': attrs.deprecated = true; break;
        case 'cache-gets': attrs.cacheGets = true; break;
        case 'nonresetable': attrs.nonResetable = true; break;
        case 'noninitable': attrs.nonInitable = true; break;
        case 'task': attrs.task = true; break;
        case 'rest': attrs.rest = true; break;
        case 'noimp': attrs.noimp = true; break;
        case 'lazywrite': attrs.lazywrite = true; break;
        case 'honor-wants': attrs.honorWants = true; break;
        case 'dcn': attrs.dcn = true; attrs.rest = true; attrs.noimp = true; break;
        case 'replicate-updates': attrs.replicateUpdates = true; break;
        case 'dsmfrowupdatedonerror': attrs.dsmfRowUpdatedOnError = true; break;
        case 'sqlview': attrs.sqlview = true; break;
        case 'admin': attrs.privilege = 'admin'; break;
        case 'advanced': attrs.privilege = 'advanced'; break;
        case 'diagnostic': attrs.privilege = 'diagnostic'; break;
        case 'test': attrs.privilege = 'test'; break;
        case 'vserver-enabled': attrs.vserverEnabled = true; break;
        case 'vserver-disabled': attrs.vserverEnabled = false; break;
        case 'ksmf-client': attrs.ksmfClient = true; break;
        case 'ksmf-server': attrs.ksmfServer = true; break;
        case 'clientdist': attrs.clientdist = true; break;
        case 'protected-iterator': attrs.protectedIterator = true; break;
        case 'bypass-compatibility-checks': attrs.bypassCompatibilityChecks = true; break;
        case 'noquery': break; // Method attribute, skip
        case 'prekmod':
        case 'precluster':
        case 'sfo-waiting':
        case 'maintenance':
        case 'normal':
        case 'no-mroot':
        case 'postkmod':
        case 'all-modes':
          attrs.bootModes = attrs.bootModes || [];
          attrs.bootModes.push(t);
          break;
        default:
          if (typeof token === 'object') {
            // Handle nested blocks like bypass-compatibility-checks { ... }
            Object.assign(attrs, token);
          } else {
            attrs.rawTokens.push(token);
          }
      }
    }

    return attrs;
  }

  // Parse method attributes from token array (loc passed in)
  function parseMethodAttributes(tokens, loc) {
    const attrs = { type: 'MethodAttributes', loc: loc, rawTokens: [] };

    for (const token of tokens) {
      const t = typeof token === 'string' ? token.toLowerCase() : token;
      switch (t) {
        case 'admin': attrs.privilege = 'admin'; break;
        case 'advanced': attrs.privilege = 'advanced'; break;
        case 'diagnostic': attrs.privilege = 'diagnostic'; break;
        case 'test': attrs.privilege = 'test'; break;
        case 'noquery': attrs.noquery = true; break;
        case 'static': attrs.static = true; break;
        case 'readonly': attrs.readonly = true; break;
        case 'extend_interface': attrs.extendInterface = true; break;
        default:
          if (typeof token === 'string') {
            attrs.rawTokens.push(token);
          }
      }
    }

    return attrs;
  }

  // Create location object from Peggy location()
  function makeLoc(peggyLoc) {
    return {
      start: {
        line: peggyLoc.start.line,
        column: peggyLoc.start.column - 1,
        offset: peggyLoc.start.offset
      },
      end: {
        line: peggyLoc.end.line,
        column: peggyLoc.end.column - 1,
        offset: peggyLoc.end.offset
      }
    };
  }
}}

// ============================================================================
// Program (Entry Point)
// ============================================================================

Program
  = _ declarations:TopLevelDeclarationList _ {
      return {
        type: 'Program',
        loc: location(),
        body: declarations,
        comments: []  // Comments collected separately
      };
    }

TopLevelDeclarationList
  = declarations:(TopLevelDeclaration _)* {
      return declarations.map(d => d[0]).filter(d => d != null);
    }

TopLevelDeclaration
  = IncludeDirective
  / EnumDeclaration
  / TypeDeclaration
  / DirectoryDeclaration
  / TableDeclaration
  / ActionDeclaration
  / ViewDeclaration
  / RelatedTablesDeclaration
  / TopLevelCommandDeclaration   // Standalone command blocks
  / ZephyrBlock                  // Standalone top-level zephyr blocks
  / LegacyOptionsBlock           // Legacy options block
  / LegacyCommandsBlock          // Legacy commands block
  / LegacyCommandRedirect        // legacy_command_redirect blocks
  / BuiltInDeclaration           // built-in command blocks
  / Comment { return null; }  // Skip standalone comments at top level
  / PathComment { return null; }  // Skip path comments

// Top-level command declaration: command "name" table { body }
TopLevelCommandDeclaration
  = "command" __ name:StringLiteral __ table:Identifier _ "{" content:NestedBraceContent "}" {
      return {
        type: 'CommandDeclaration',
        loc: location(),
        name: name,
        table: table,
        raw: content
      };
    }

// Legacy options block - just capture raw content
LegacyOptionsBlock
  = "legacy_options" _ "{" content:NestedBraceContent "}" {
      return {
        type: 'LegacyOptionsBlock',
        loc: location(),
        raw: content
      };
    }

// Legacy commands block - just capture raw content
LegacyCommandsBlock
  = "legacy_commands" _ "{" content:NestedBraceContent "}" {
      return {
        type: 'LegacyCommandsBlock',
        loc: location(),
        raw: content
      };
    }

// Legacy command redirect - capture as raw content
LegacyCommandRedirect
  = "legacy_command_redirect" _ name:StringLiteral _ msg:StringLiteral _ "{" content1:NestedBraceContent "}" _
    "{" content2:NestedBraceContent "}" {
      return {
        type: 'LegacyCommandRedirect',
        loc: location(),
        command: name,
        message: msg,
        raw: content2
      };
    }
  / "legacy_command_redirect" _ name:StringLiteral _ msg:StringLiteral {
      return {
        type: 'LegacyCommandRedirect',
        loc: location(),
        command: name,
        message: msg
      };
    }

// built-in "name" { flags } { body }
BuiltInDeclaration
  = "built-in" __ name:StringLiteral _ "{" flags:NestedBraceContent "}" _ "{" body:NestedBraceContent "}" {
      return {
        type: 'BuiltInDeclaration',
        loc: location(),
        name: name,
        flags: flags.trim(),
        raw: body
      };
    }

NestedBraceContent
  = chars:NestedBraceChar* { return chars.join(''); }

NestedBraceChar
  = [^{}]
  / "{" chars:NestedBraceContent "}" { return '{' + chars + '}'; }

// ============================================================================
// Include Directive
// ============================================================================

IncludeDirective
  = "include" _ "{" _ paths:IncludePaths _ "}" {
      return {
        type: 'IncludeDirective',
        loc: location(),
        paths: paths
      };
    }

IncludePaths
  = paths:(IncludePath _)* {
      return paths.map(p => p[0]);
    }

IncludePath
  = path:$[^\s}]+ {
      return {
        type: 'StringLiteral',
        loc: location(),
        value: path,
        raw: path
      };
    }

// ============================================================================
// Type Declaration
// ============================================================================

TypeDeclaration
  = "type" __ name:Identifier _ "{" _ body:TypeBody _ "}" {
      return {
        type: 'TypeDeclaration',
        loc: location(),
        name: name,
        ...body
      };
    }

TypeBody
  = items:(TypeBodyItem _)* {
      const result = {};
      for (const [item] of items) {
        if (item) Object.assign(result, item);
      }
      return result;
    }

TypeBodyItem
  = "ui_name" __ value:StringLiteral { return { uiName: value }; }
  / "help" __ value:StringLiteral { return { help: value }; }
  / zephyr:ZephyrBlock { return { zephyr: zephyr }; }
  / Comment { return null; }

// ============================================================================
// Enum Declaration
// ============================================================================

EnumDeclaration
  = "enum" __ name:Identifier __ description:StringLiteral _ "{" _ members:EnumBody _ "}" {
      return {
        type: 'EnumDeclaration',
        loc: location(),
        name: name,
        description: description,
        members: members.members,
        zephyr: members.zephyr,
        zapi: members.zapi
      };
    }
  / "enum" __ name:Identifier _ "{" _ members:EnumBody _ "}" {
      // Enum without description
      return {
        type: 'EnumDeclaration',
        loc: location(),
        name: name,
        description: null,
        members: members.members,
        zephyr: members.zephyr,
        zapi: members.zapi
      };
    }

EnumBody
  = items:(EnumBodyItem _)* {
      const members = [];
      let zephyr = null;
      let zapi = null;
      for (const [item] of items) {
        if (item && item.type === 'EnumMember') {
          members.push(item);
        } else if (item && item.type === 'ZephyrBlock') {
          zephyr = item;
        } else if (item && item.type === 'ZapiBlock') {
          zapi = item;
        }
      }
      return { members, zephyr, zapi };
    }

EnumBodyItem
  = EnumMember
  / ZephyrBlock
  / ZapiBlock
  / Comment { return null; }

EnumMember
  = name:EnumMemberName _ "=" _ value:Integer description:(__ StringLiteral)? {
      return {
        type: 'EnumMember',
        loc: location(),
        name: name,
        value: value,
        description: description ? description[1] : null
      };
    }
  / name:EnumMemberName __ description:StringLiteral {
      // Enum member without explicit value (just name and description)
      return {
        type: 'EnumMember',
        loc: location(),
        name: name,
        value: null,
        description: description
      };
    }
  / !("zapi" / "zephyr") name:EnumMemberName {
      // Bare enum member name with no value or description
      // Exclude reserved keywords that start blocks
      return {
        type: 'EnumMember',
        loc: location(),
        name: name,
        value: null,
        description: null
      };
    }

// Enum member names can contain dots (like C.UTF-8), can start with digits (like 8K),
// can contain slashes (like tcp/udp), plus (like qsfp+), and colons (like name:constituent)
EnumMemberName
  = name:$([a-zA-Z0-9_][a-zA-Z0-9_.+/:_-]*) {
      return {
        type: 'EnumMemberName',
        loc: location(),
        name: name
      };
    }

// ============================================================================
// Directory Declaration
// ============================================================================

DirectoryDeclaration
  = "directory" __ path:StringLiteral _ "{" _ body:DirectoryBody _ "}" {
      return {
        type: 'DirectoryDeclaration',
        loc: location(),
        path: path,
        ...body
      };
    }
  / "directory" __ path:Identifier _ "{" _ body:DirectoryBody _ "}" {
      return {
        type: 'DirectoryDeclaration',
        loc: location(),
        path: path.name,
        ...body
      };
    }

DirectoryBody
  = items:(DirectoryBodyItem _)* {
      const result = {};
      for (const [item] of items) {
        if (item) Object.assign(result, item);
      }
      return result;
    }

DirectoryBodyItem
  = "help" __ value:StringLiteral { return { help: value }; }
  / "hidden" { return { hidden: true }; }
  / AliasBlock { return { alias: arguments[0] }; }
  / Comment { return null; }

AliasBlock
  = "alias" __ name:StringLiteral __ command:StringLiteral _
    "{" _ attrs:AttributeTokens? _ "}" _
    "{" _ body:AliasBodyContent _ "}" {
      return {
        type: 'AliasBlock',
        loc: location(),
        name: name,
        command: command,
        attributes: attrs || [],
        ...body
      };
    }

AliasBodyContent
  = items:(AliasBodyItem _)* {
      const result = {};
      for (const [item] of items) {
        if (item) Object.assign(result, item);
      }
      return result;
    }

AliasBodyItem
  = "hidden" { return { hidden: true }; }
  / "help" __ value:StringLiteral { return { help: value }; }
  / Comment { return null; }

// ============================================================================
// Table Declaration
// ============================================================================

TableDeclaration
  = "table" __ name:Identifier __ description:StringLiteral _
    "{" _ attrTokens:AttributeTokens _ "}" _
    "{" _ body:TableBodyContent _ "}" {
      return {
        type: 'TableDeclaration',
        loc: location(),
        name: name,
        description: description,
        attributes: parseAttributes(attrTokens, location()),
        body: body
      };
    }
  / "table" __ name:Identifier __ description:StringLiteral _
    "{" _ attrTokens:AttributeTokens _ "}" !(_ "{") {
      // Table with only attributes, no body (e.g., table foo "desc" { replicated })
      return {
        type: 'TableDeclaration',
        loc: location(),
        name: name,
        description: description,
        attributes: parseAttributes(attrTokens, location()),
        body: { type: 'TableBody', loc: location() }
      };
    }
  / "table" __ name:Identifier __ description:StringLiteral _
    "{" _ body:TableBodyContent _ "}" {
      return {
        type: 'TableDeclaration',
        loc: location(),
        name: name,
        description: description,
        attributes: { type: 'TableAttributes', loc: location(), rawTokens: [] },
        body: body
      };
    }

// ============================================================================
// Action Declaration
// ============================================================================

ActionDeclaration
  = "action" __ name:Identifier __ description:StringLiteral _
    "{" _ attrTokens:AttributeTokens _ "}" _
    "{" _ body:TableBodyContent _ "}" {
      return {
        type: 'ActionDeclaration',
        loc: location(),
        name: name,
        description: description,
        attributes: parseAttributes(attrTokens, location()),
        body: body
      };
    }
  / "action" __ name:Identifier __ description:StringLiteral _
    "{" _ attrTokens:AttributeTokens _ "}" !(_ "{") {
      // Action with only attributes, no body
      return {
        type: 'ActionDeclaration',
        loc: location(),
        name: name,
        description: description,
        attributes: parseAttributes(attrTokens, location()),
        body: { type: 'TableBody', loc: location() }
      };
    }
  / "action" __ name:Identifier __ description:StringLiteral _
    "{" _ body:TableBodyContent _ "}" {
      return {
        type: 'ActionDeclaration',
        loc: location(),
        name: name,
        description: description,
        attributes: { type: 'TableAttributes', loc: location(), rawTokens: [] },
        body: body
      };
    }

// ============================================================================
// View Declaration
// ============================================================================

ViewDeclaration
  = "view" __ name:Identifier __ description:StringLiteral _
    "{" _ attrTokens:AttributeTokens _ "}" _
    "{" _ body:ViewBodyContent _ "}" {
      return {
        type: 'ViewDeclaration',
        loc: location(),
        name: name,
        description: description,
        attributes: parseAttributes(attrTokens, location()),
        body: body
      };
    }
  / "view" __ name:Identifier __ description:StringLiteral _
    "{" _ body:ViewBodyContent _ "}" {
      return {
        type: 'ViewDeclaration',
        loc: location(),
        name: name,
        description: description,
        attributes: { type: 'TableAttributes', loc: location(), rawTokens: [] },
        body: body
      };
    }

// ============================================================================
// Related Tables Declaration
// ============================================================================

RelatedTablesDeclaration
  = "related-tables" _ "{" _ tables:RelatedTablesList _ "}" {
      return {
        type: 'RelatedTablesDeclaration',
        loc: location(),
        tables: tables
      };
    }

RelatedTablesList
  = items:(Identifier _)* {
      return items.map(i => i[0]);
    }

// ============================================================================
// Attribute Tokens
// ============================================================================

AttributeTokens
  = tokens:(AttributeToken _)* {
      return tokens.map(t => t[0]).filter(t => t != null);
    }

AttributeToken
  = NestedAttributeBlock
  / token:AttributeWord { return token; }

NestedAttributeBlock
  = name:("bypass-compatibility-checks" / "private-fields" / "write-privilege") _ "{" _ items:AttributeBlockItems _ "}" {
      if (name === 'bypass-compatibility-checks') {
        return { bypassCompatibilityChecks: items.length > 0 ? items : true };
      } else if (name === 'private-fields') {
        return { privateFields: items };
      } else if (name === 'write-privilege') {
        return { writePrivilege: items };
      }
      return null;
    }

AttributeBlockItems
  = items:(AttributeWord _)* {
      return items.map(i => i[0]);
    }

AttributeWord
  = $([a-zA-Z][a-zA-Z0-9_\-]* ("." [a-zA-Z][a-zA-Z0-9_\-]*)* (":" [a-zA-Z][a-zA-Z0-9_\-]*)?)

// ============================================================================
// Table Body Content
// ============================================================================

TableBodyContent
  = items:(TableBodyItem _)* {
      const body = { type: 'TableBody', loc: location() };
      for (const [item] of items) {
        if (item == null) continue;
        switch (item.type) {
          case 'FieldsBlock': body.fields = item; break;
          case 'MethodsBlock': body.methods = item; break;
          case 'CommandBlock': body.command = item; break;
          case 'ZephyrBlock': body.zephyr = item; break;
          case 'DescriptionsBlock': body.descriptions = item; break;
          case 'DistKeysDirective': body.distKeys = item; break;
          case 'AlternateKeysDirective':
            body.alternateKeys = body.alternateKeys || [];
            body.alternateKeys.push(item);
            break;
          case 'CloneFieldsDirective': body.cloneFields = item; break;
          case 'KeysFromBlock': body.keysFrom = item; break;
          case 'InheritFromBlock': body.inheritFrom = item; break;
          case 'ObjectReplicationBlock': body.objectReplication = item; break;
          case 'ValuesBlock': body.values = item; break;
          case 'WritePrivilegeDirective': body.writePrivilege = item; break;
          case 'AttachDirective': body.attach = item; break;
          case 'ViewQueryDirective': body.viewQuery = item; break;
          case 'SqlFieldsBlock': body.sqlFields = item; break;
          case 'SqlDerivedFieldsBlock': body.sqlDerivedFields = item; break;
        }
      }
      return body;
    }

TableBodyItem
  = FieldsBlock
  / MethodsBlock
  / CommandBlock
  / ZephyrBlock
  / DescriptionsBlock
  / DistKeysDirective
  / DistCacheSizeDirective
  / AlternateKeysDirective
  / CloneFieldsDirective
  / KeysFromBlock
  / InheritFromBlock
  / ObjectReplicationBlock
  / ValuesBlock
  / WritePrivilegeDirective
  / PrivilegeBlock
  / AttachDirective
  / ViewQueryDirective
  / SqlFieldsBlock
  / SqlDerivedFieldsBlock
  / LicenseDirective
  / ExtendInterfaceDirective
  / AsupBlock
  / SnmpBlock
  / VirtualsBlock
  / VserverFieldDirective
  / FieldReflectionBlock  // field-reflection { ... }
  / BypassCompatibilityDirective
  / DynamicallyAddedDirective
  / DynamicallyChangedDirective
  / RpcTimeoutDirective
  / DirectoryDirective  // directory "name" { attribs }
  / BootlevelDirective  // bootlevel mode { fields }
  / AllowSubscribersDirective  // allow-subscribers flag
  / UseDirective  // use method_impl
  / SimpleDirectiveFlag  // Simple flag directives like abort-on-next-error
  / GenericBracedDirective  // name { value } - generic catch-all for unknown directives
  / UnrecognizedContent  // Catch unrecognized content
  / Comment { return null; }

// Directory directive within table body
DirectoryDirective
  = "directory" __ name:StringLiteral _ "{" content:NestedBraceContent "}" {
      return {
        type: 'DirectoryDirective',
        loc: location(),
        name: name,
        raw: content.trim()
      };
    }

// Bootlevel directive: bootlevel mode { fields } - can appear in table or command bodies
BootlevelDirective
  = "bootlevel" __ mode:BootlevelMode _ "{" _ fields:IdentifierList _ "}" {
      return {
        type: 'BootlevelDirective',
        loc: location(),
        mode: mode,
        fields: fields
      };
    }

// Allow-subscribers flag directive
AllowSubscribersDirective
  = "allow-subscribers" {
      return {
        type: 'AllowSubscribersDirective',
        loc: location()
      };
    }

// Simple flag directives that are just a hyphenated identifier (not followed by { or string)
SimpleDirectiveFlag
  = !BlockKeyword name:$([a-z][a-z0-9\-]*) !(_ "{" / __ StringLiteral) {
      return {
        type: 'SimpleDirectiveFlag',
        loc: location(),
        name: name
      };
    }

// Generic braced directive: name { content }
GenericBracedDirective
  = !BlockKeyword name:Identifier _ "{" content:NestedBraceContent "}" {
      return {
        type: 'GenericDirective',
        loc: location(),
        name: name.name,
        content: content.trim()
      };
    }

// Field reflection block - captures raw content
FieldReflectionBlock
  = "field-reflection" _ "{" content:NestedBraceContent "}" {
      return {
        type: 'FieldReflectionBlock',
        loc: location(),
        raw: content
      };
    }

// Dynamically changed directive
DynamicallyChangedDirective
  = "dynamically-changed" _ "{" _ fields:IdentifierList _ "}" {
      return {
        type: 'DynamicallyChangedDirective',
        loc: location(),
        fields: fields
      };
    }

// Catch-all for unrecognized content (e.g., stray SQL from malformed VIEW strings)
// Captures content that doesn't start a valid block, stopping before block keywords
UnrecognizedContent
  = !BlockKeyword content:UnrecognizedLine+ {
      return {
        type: 'UnrecognizedContent',
        loc: location(),
        content: content.join('\n').trim()
      };
    }

UnrecognizedLine
  = !BlockKeyword chars:$[^\n{}]+ [\n]? { return chars; }

BlockKeyword
  = "fields" / "methods" / "command" / "zephyr" / "descriptions" / "dist_keys"
  / "alternateKeys" / "clone-fields" / "keys" / "inherit_from" / "object-replication"
  / "values" / "write-privilege" / "privilege" / "ATTACH" / "VIEW"
  / "sql-fields" / "sql-derived-fields" / "license" / "extend_interface"
  / "extend_alt_interface" / "asup" / "snmp" / "virtuals" / "vserver-field"
  / "bypass-compatibility-checks" / "dynamically-added" / "dynamically-changed"
  / "field-reflection" / "rpc_timeout" / "dist_cache_size" / "use" / "}"

// Virtuals block: virtuals { method_list }
VirtualsBlock
  = "virtuals" _ "{" _ methods:IdentifierList _ "}" {
      return {
        type: 'VirtualsBlock',
        loc: location(),
        methods: methods
      };
    }

// dist_cache_size directive
DistCacheSizeDirective
  = "dist_cache_size" __ size:Integer {
      return {
        type: 'DistCacheSizeDirective',
        loc: location(),
        size: size.value
      };
    }
  / "dist_cache_size" _ "{" _ size:Integer _ "}" {
      return {
        type: 'DistCacheSizeDirective',
        loc: location(),
        size: size.value
      };
    }

// SNMP block: snmp MIB-NAME tableName { field-mappings }
SnmpBlock
  = "snmp" __ mibName:Identifier __ tableName:Identifier _
    "{" _ mappings:SnmpMappingList _ "}" {
      return {
        type: 'SnmpBlock',
        loc: location(),
        mibName: mibName,
        tableName: tableName,
        mappings: mappings
      };
    }

SnmpMappingList
  = mappings:(SnmpMapping _)* {
      return mappings.map(m => m[0]).filter(m => m != null);
    }

SnmpMapping
  = smfField:Identifier __ snmpField:Identifier {
      return {
        type: 'SnmpMapping',
        loc: location(),
        smfField: smfField,
        snmpField: snmpField
      };
    }
  / Comment { return null; }

// Bypass compatibility checks directive
BypassCompatibilityDirective
  = "bypass-compatibility-checks" _ "{" _ items:DottedIdentifierList _ "}" {
      return {
        type: 'BypassCompatibilityDirective',
        loc: location(),
        items: items
      };
    }

// Dynamically added fields directive
DynamicallyAddedDirective
  = "dynamically-added" _ "{" _ fields:IdentifierList _ "}" {
      return {
        type: 'DynamicallyAddedDirective',
        loc: location(),
        fields: fields
      };
    }

// RPC timeout directive
RpcTimeoutDirective
  = "rpc_timeout" _ "{" _ value:$[^}]+ _ "}" {
      return {
        type: 'RpcTimeoutDirective',
        loc: location(),
        value: value.trim()
      };
    }
  / "rpc_timeout" __ value:$[0-9]+[a-zA-Z]* {
      return {
        type: 'RpcTimeoutDirective',
        loc: location(),
        value: value
      };
    }

// AutoSupport block
AsupBlock
  = "asup" __ name:StringLiteral _ "{" _ attrs:AttributeTokens _ "}" _
    "{" _ fields:AsupFieldList _ "}" {
      return {
        type: 'AsupBlock',
        loc: location(),
        name: name,
        attributes: attrs,
        fields: fields
      };
    }
  // asup with identifier name (no quotes)
  / "asup" __ name:Identifier _ "{" _ attrs:AttributeTokens _ "}" _
    "{" _ fields:AsupFieldList _ "}" {
      return {
        type: 'AsupBlock',
        loc: location(),
        name: name,
        attributes: attrs,
        fields: fields
      };
    }

AsupFieldList
  = fields:(AsupField _)* {
      return fields.map(f => f[0]).filter(f => f != null);
    }

AsupField
  = name:DottedIdentifier __ desc:StringLiteral _ attrs:("{" _ AttributeTokens _ "}")? {
      return {
        type: 'AsupField',
        loc: location(),
        name: name,
        description: desc,
        attributes: attrs ? attrs[2] : []
      };
    }
  // Both name and output are quoted strings
  / name:StringLiteral __ output:StringLiteral _ attrs:("{" _ AttributeTokens _ "}")? {
      return {
        type: 'AsupField',
        loc: location(),
        name: name,
        output: output,
        attributes: attrs ? attrs[2] : []
      };
    }
  // name alias { attrs } - both identifiers, no description
  / name:DottedIdentifier __ alias:DottedIdentifier _ attrs:("{" _ AttributeTokens _ "}")? {
      return {
        type: 'AsupField',
        loc: location(),
        name: name,
        alias: alias,
        attributes: attrs ? attrs[2] : []
      };
    }
  / Comment { return null; }

ExtendInterfaceDirective
  = "extend_interface" {
      return {
        type: 'ExtendInterfaceDirective',
        loc: location()
      };
    }
  / "extend_alt_interface" {
      return {
        type: 'ExtendAltInterfaceDirective',
        loc: location()
      };
    }

// ============================================================================
// View Body Content (extends Table Body)
// ============================================================================

ViewBodyContent
  = items:(ViewBodyItem _)* {
      const body = { type: 'ViewBody', loc: location() };
      for (const [item] of items) {
        if (item == null) continue;
        switch (item.type) {
          case 'FieldsBlock': body.fields = item; break;
          case 'MethodsBlock': body.methods = item; break;
          case 'CommandBlock': body.command = item; break;
          case 'ZephyrBlock': body.zephyr = item; break;
          case 'DescriptionsBlock': body.descriptions = item; break;
          case 'DistKeysDirective': body.distKeys = item; break;
          case 'AlternateKeysDirective':
            body.alternateKeys = body.alternateKeys || [];
            body.alternateKeys.push(item);
            break;
          case 'KeysFromBlock': body.keysFrom = item; break;
          case 'InheritFromBlock': body.inheritFrom = item; break;
          case 'ValuesBlock': body.values = item; break;
          case 'AttachDirective': body.attach = item; break;
          case 'ViewQueryDirective': body.viewQuery = item; break;
          case 'SqlFieldsBlock': body.sqlFields = item; break;
          case 'SqlDerivedFieldsBlock': body.sqlDerivedFields = item; break;
        }
      }
      return body;
    }

ViewBodyItem
  = TableBodyItem
  / AttachDirective
  / ViewQueryDirective
  / SqlFieldsBlock
  / SqlDerivedFieldsBlock

// ============================================================================
// Fields Block
// ============================================================================

FieldsBlock
  = "fields" _ "{" _ fields:FieldList _ "}" {
      return {
        type: 'FieldsBlock',
        loc: location(),
        fields: fields
      };
    }

FieldList
  = fields:(FieldListItem _)* {
      return fields.map(f => f[0]).filter(f => f != null);
    }

FieldListItem
  = GroupStartMarker  // Just marks start of group
  / GroupEndField     // Field that ends a group (has trailing ))
  / GroupContinueField  // Field that continues a group (starts with |)
  / FieldDeclaration
  / Comment { return null; }

// ( at the start of a field group
GroupStartMarker
  = "(" {
      return {
        type: 'GroupStartMarker',
        loc: location()
      };
    }

// Field that ends a group, has ) after the name
GroupEndField
  // name=alias) "description" type role[priority]  (alias before close paren)
  = prefixes:FieldPrefixes? name:FieldName aliasPart:FieldAlias ")"
    __ description:StringLiteral __ fieldType:FieldType __ role:FieldRole
    roleModifier:FieldRoleModifier? priority:FieldPriority? {
      return {
        type: 'FieldDeclaration',
        loc: location(),
        prefixes: parsePrefixes(prefixes),
        name: name,
        alias: aliasPart,
        description: description,
        fieldType: fieldType,
        role: role,
        roleModifier: roleModifier,
        priority: priority ? priority.value : undefined,
        pidPersistent: priority ? priority.persistent : undefined,
        groupEnd: true
      };
    }
  // name) "description" type role[priority]  (close paren after name, alias optional)
  / prefixes:FieldPrefixes? name:FieldName ")" uiNamePart:FieldUiName? aliasPart:FieldAlias?
    __ description:StringLiteral __ fieldType:FieldType __ role:FieldRole
    roleModifier:FieldRoleModifier? priority:FieldPriority? {
      return {
        type: 'FieldDeclaration',
        loc: location(),
        prefixes: parsePrefixes(prefixes),
        name: name,
        uiName: uiNamePart ? uiNamePart.name : undefined,
        useUiNameInCode: uiNamePart ? uiNamePart.useInCode : undefined,
        alias: aliasPart,
        description: description,
        fieldType: fieldType,
        role: role,
        roleModifier: roleModifier,
        priority: priority ? priority.value : undefined,
        pidPersistent: priority ? priority.persistent : undefined,
        groupEnd: true
      };
    }

// Field that continues a group, starts with |
GroupContinueField
  = "|" prefixes:FieldPrefixes? name:FieldName uiNamePart:FieldUiName? aliasPart:FieldAlias? groupEnd:")"?
    __ description:StringLiteral _? fieldType:FieldType __ role:FieldRole
    roleModifier:FieldRoleModifier? priority:FieldPriority? {
      return {
        type: 'FieldDeclaration',
        loc: location(),
        prefixes: parsePrefixes(prefixes),
        name: name,
        uiName: uiNamePart ? uiNamePart.name : undefined,
        useUiNameInCode: uiNamePart ? uiNamePart.useInCode : undefined,
        alias: aliasPart,
        description: description,
        fieldType: fieldType,
        role: role,
        roleModifier: roleModifier,
        priority: priority ? priority.value : undefined,
        pidPersistent: priority ? priority.persistent : undefined,
        groupContinue: true,
        groupEnd: groupEnd ? true : undefined
      };
    }

FieldDeclaration
  = prefixes:FieldPrefixes? name:FieldName uiNamePart:FieldUiName? aliasPart:FieldAlias?
    __ description:StringLiteral _? fieldType:FieldType __ role:FieldRole
    roleModifier:FieldRoleModifier? priority:FieldPriority? {
      return {
        type: 'FieldDeclaration',
        loc: location(),
        prefixes: parsePrefixes(prefixes),
        name: name,
        uiName: uiNamePart ? uiNamePart.name : undefined,
        useUiNameInCode: uiNamePart ? uiNamePart.useInCode : undefined,
        alias: aliasPart,
        description: description,
        fieldType: fieldType,
        role: role,
        roleModifier: roleModifier,
        priority: priority ? priority.value : undefined,
        pidPersistent: priority ? priority.persistent : undefined
      };
    }
  / Comment { return null; }

FieldPrefixes
  = $("~" / "!" / "-")+

FieldName
  = name:$([a-zA-Z0-9_][a-zA-Z0-9_.\-:]*) {
      return {
        type: 'Identifier',
        loc: location(),
        name: name
      };
    }

FieldUiName
  = "=" useInCode:"^" uiName:$([a-zA-Z][a-zA-Z0-9_.\-:]*) {
      return {
        name: {
          type: 'Identifier',
          loc: location(),
          name: uiName
        },
        useInCode: true
      };
    }

FieldAlias
  // =longAlias,shortAlias combined
  = "=" alias:$([a-zA-Z_][a-zA-Z0-9_.\-:]*) "," short:$[a-zA-Z] { return { long: alias, short: short }; }
  // =longAlias only
  / "=" alias:$([a-zA-Z_][a-zA-Z0-9_.\-:]*) { return alias; }
  // ,shortAlias only
  / "," alias:$[a-zA-Z] { return alias; }

FieldType
  = baseType:$([a-zA-Z][a-zA-Z0-9_-]*) range:TypeRange? listMods:ListModifiers? {
      return {
        type: 'FieldType',
        loc: location(),
        baseType: baseType,
        range: range,
        listModifiers: listMods
      };
    }

TypeRange
  = "<" min:SignedInteger "..." max:SignedInteger? ">" {
      return {
        type: 'TypeRange',
        loc: location(),
        min: min,
        max: max ?? null,
        inclusive: true
      };
    }
  / "<" min:SignedInteger ".." max:SignedInteger? ">" {
      return {
        type: 'TypeRange',
        loc: location(),
        min: min,
        max: max ?? null,
        inclusive: false
      };
    }

ListModifiers
  = "<" content:NestedTypeContent ">" {
      return [content];
    }

// Content inside angle brackets that can contain nested <> pairs
NestedTypeContent
  = chars:NestedTypeChar+ { return chars.join(''); }

NestedTypeChar
  = [^<>]
  / "<" inner:NestedTypeContent ">" { return '<' + inner + '>'; }

FieldRole
  = role:("key-forsort" / "key-required" / "key-nocreate" / "key"
         / "show-required" / "show-noread" / "show"
         / "write-noread" / "write"
         / "read" / "create-noread" / "create" / "modify-noread" / "modify") {
      return role;
    }

FieldRoleModifier
  = mod:"-noread" { return mod; }

FieldPriority
  = "[" value:Integer "]" { return { value: value.value, persistent: false }; }
  / "(" value:Integer ")" { return { value: value.value, persistent: true }; }

// ============================================================================
// Methods Block
// ============================================================================

MethodsBlock
  = "methods" _ "{" _ methods:MethodList _ "}" {
      return {
        type: 'MethodsBlock',
        loc: location(),
        methods: methods
      };
    }

MethodList
  = methods:(MethodDeclaration _)* {
      return methods.map(m => m[0]).filter(m => m != null);
    }

MethodDeclaration
  = "method" __ name:Identifier __ description:StringLiteral _
    "{" _ attrTokens:AttributeTokens _ "}" _
    "{" _ body:MethodBody _ "}" {
      return {
        type: 'MethodDeclaration',
        loc: location(),
        name: name,
        description: description,
        attributes: parseMethodAttributes(attrTokens, location()),
        ...body
      };
    }
  / Comment { return null; }

MethodBody
  = items:(MethodBodyItem _)* {
      const result = {};
      for (const [item] of items) {
        if (item == null) continue;
        if (item.type === 'ArgsBlock') result.args = item;
        else if (item.type === 'CommandBlock') result.command = item;
        else if (item.type === 'ZephyrBlock') result.zephyr = item;
      }
      return result;
    }

MethodBodyItem
  = ArgsBlock
  / CommandBlock  // Full command block with body
  / ZephyrBlock   // Zephyr block can appear in methods
  / VserverFieldDirective  // vserver-field {field}
  / DistKeysDirective  // dist_keys from table
  / RpcTimeoutDirective  // rpc_timeout 180s or rpc_timeout { value }
  / PublicIteratorDirective  // public-iterator
  / GenerateHelperMethodsDirective  // generate-helper-methods { items }
  / UseDirective  // use method_impl
  / VirtualsBlock  // virtuals { methods }
  / InheritFromBlock  // inherit_from {table}
  / PrivilegeBlock  // privilege directives in methods
  / WritePrivilegeDirective  // write-privilege { specs } { fields }
  / LicenseDirective  // license { features }
  / FriendDirective  // friend "class name"
  / "args-as-fields" { return { type: 'ArgsAsFieldsDirective', loc: location() }; }
  / MethodGenericDirective  // name value { items } - generic catch-all
  / Comment { return null; }

// Generic method directive: keyword value { items }
MethodGenericDirective
  = !MethodBlockKeyword keyword:Identifier __ value:Identifier _ "{" content:NestedBraceContent "}" {
      return {
        type: 'GenericDirective',
        loc: location(),
        keyword: keyword.name,
        value: value.name,
        content: content.trim()
      };
    }
  / !MethodBlockKeyword keyword:Identifier _ "{" content:NestedBraceContent "}" {
      return {
        type: 'GenericDirective',
        loc: location(),
        keyword: keyword.name,
        content: content.trim()
      };
    }

MethodBlockKeyword
  = "args" / "command" / "zephyr" / "vserver-field" / "dist_keys" / "rpc_timeout"
  / "public-iterator" / "generate-helper-methods" / "use" / "virtuals" / "inherit_from"
  / "privilege" / "license" / "friend" / "}"

FriendDirective
  = "friend" __ className:StringLiteral {
      return {
        type: 'FriendDirective',
        loc: location(),
        className: className
      };
    }

UseDirective
  = "use" __ impl:Identifier {
      return {
        type: 'UseDirective',
        loc: location(),
        implementation: impl
      };
    }

GenerateHelperMethodsDirective
  = "generate-helper-methods" _ "{" _ items:IdentifierList _ "}" {
      return {
        type: 'GenerateHelperMethodsDirective',
        loc: location(),
        items: items
      };
    }

PublicIteratorDirective
  = "public-iterator" {
      return {
        type: 'PublicIteratorDirective',
        loc: location()
      };
    }

VserverFieldDirective
  = "vserver-field" _ "{" _ field:DottedIdentifier _ "}" {
      return {
        type: 'VserverFieldDirective',
        loc: location(),
        field: field
      };
    }

// Dotted identifier like svm.uuid, v4.0-acl, svm.uuid. (trailing dot allowed)
DottedIdentifier
  = $([a-zA-Z_][a-zA-Z0-9_\-]* ("." [a-zA-Z0-9_][a-zA-Z0-9_\-]*)* "."?)

ArgsBlock
  = "args" _ "{" _ args:ArgList _ "}" {
      return {
        type: 'ArgsBlock',
        loc: location(),
        args: args
      };
    }

ArgList
  = args:(ArgListItem _)* {
      return args.map(a => a[0]).filter(a => a != null);
    }

ArgListItem
  = ArgGroupStartMarker  // ( at start of arg group
  / ArgGroupEndDeclaration  // Arg that ends a group
  / ArgGroupContinueDeclaration  // Arg that continues a group (starts with |)
  / ArgDeclaration
  / Comment { return null; }

ArgGroupStartMarker
  = "(" { return { type: 'ArgGroupStartMarker', loc: location() }; }

ArgGroupEndDeclaration
  = deprecated:"~"? optional:"!"? prefix:"-"? name:ArgName alias:ArgAlias? ")" __ description:StringLiteral __
    argType:FieldType __ role:ArgRole priority:FieldPriority? {
      return {
        type: 'ArgDeclaration',
        loc: location(),
        deprecated: deprecated === '~',
        optional: optional === '!',
        name: prefix ? '-' + name : name,
        alias: alias,
        description: description,
        argType: argType,
        role: role,
        priority: priority ? priority.value : undefined,
        groupEnd: true
      };
    }

ArgGroupContinueDeclaration
  = "|" deprecated:"~"? optional:"!"? prefix:"-"? name:ArgName alias:ArgAlias? groupEnd:")"? __ description:StringLiteral __
    argType:FieldType __ role:ArgRole priority:FieldPriority? {
      return {
        type: 'ArgDeclaration',
        loc: location(),
        deprecated: deprecated === '~',
        optional: optional === '!',
        name: prefix ? '-' + name : name,
        alias: alias,
        name: prefix ? '-' + name : name,
        description: description,
        argType: argType,
        role: role,
        priority: priority ? priority.value : undefined,
        groupContinue: true,
        groupEnd: groupEnd ? true : undefined
      };
    }

ArgDeclaration
  = deprecated:"~"? optional:"!"? prefix:"-"? name:ArgName alias:ArgAlias? __ description:StringLiteral __
    argType:FieldType __ role:ArgRole priority:FieldPriority? {
      return {
        type: 'ArgDeclaration',
        loc: location(),
        deprecated: deprecated === '~',
        optional: optional === '!',
        name: prefix ? '-' + name : name,
        alias: alias,
        description: description,
        argType: argType,
        role: role,
        priority: priority ? priority.value : undefined
      };
    }
  / Comment { return null; }

// Argument name can start with digits and contain dots (e.g., 64bit-upgrade, status.mirrorState)
ArgName
  = name:$([a-zA-Z0-9_][a-zA-Z0-9_.\-]*) { return name; }

ArgAlias
  // =longAlias,shortAlias combined
  = "=" useInCode:"^"? aliasName:$([a-zA-Z_][a-zA-Z0-9_\-]*) "," shortChar:$[a-zA-Z] {
      return { name: aliasName, useInCode: useInCode === '^', shortForm: shortChar };
    }
  // =longAlias only
  / "=" useInCode:"^"? aliasName:$([a-zA-Z_][a-zA-Z0-9_\-]*) {
      return { name: aliasName, useInCode: useInCode === '^' };
    }
  // ,shortAlias only
  / "," aliasChar:$[a-zA-Z] {
      return { name: aliasChar, shortForm: true };
    }

ArgRole
  = role:("in-noread" / "in" / "out-noread" / "out" / "write-noread" / "write" / "read" / "modify-noread" / "modify" / "key-forsort" / "key" / "create-noread" / "create") { return role; }

// ============================================================================
// Command Block
// ============================================================================

CommandBlock
  = "command" __ command:StringLiteral _ "{" _ body:CommandBodyContent _ "}" {
      return {
        type: 'CommandBlock',
        loc: location(),
        command: command,
        ...body
      };
    }
  / "command" __ command:StringLiteral {
      return {
        type: 'CommandBlock',
        loc: location(),
        command: command
      };
    }

CommandBodyContent
  = items:(CommandBodyItem _)* {
      const result = { show: [], showInstance: [] };
      for (const [item] of items) {
        if (item == null) continue;
        if (item.helpShow) result.helpShow = item.helpShow;
        else if (item.helpModify) result.helpModify = item.helpModify;
        else if (item.help) result.help = item.help;
        else if (item.emptyMsg) result.emptyMsg = item.emptyMsg;
        else if (item.type === 'ShowBlock') {
          if (item.showType === 'show') result.show.push(item);
          else result.showInstance.push(item);
        }
      }
      return result;
    }

CommandBodyItem
  = "help_show" __ value:StringLiteral { return { helpShow: value }; }
  / "help_modify" __ value:StringLiteral { return { helpModify: value }; }
  / "help_delete" __ value:StringLiteral { return { helpDelete: value }; }
  / "help_new" __ value:StringLiteral { return { helpNew: value }; }
  / "help_create" __ value:StringLiteral { return { helpCreate: value }; }
  / "help" __ value:StringLiteral { return { help: value }; }
  / "empty_msg" __ value:StringLiteral { return { emptyMsg: value }; }
  / "grouping" _ "{" _ items:IdentifierList _ "}" { return { grouping: items }; }
  / "preparse" _ "{" _ methods:IdentifierList _ "}" { return { preparse: methods }; }
  / "preparse" { return { preparse: [] }; }  // Standalone preparse marker
  / "remove" _ "{" _ methods:IdentifierList _ "}" { return { remove: methods }; }
  / "remove" __ method:Identifier { return { remove: [method.name] }; }  // Inline form
  / "hidden" { return { hidden: true }; }
  / "collapse" { return { collapse: true }; }
  / "externalize" _ "{" _ targets:StringList _ "}" { return { externalize: targets }; }
  / "bootlevel" __ mode:BootlevelMode _ "{" _ methods:IdentifierList _ "}" { return { bootlevel: { mode: mode, methods: methods } }; }
  / PrivilegeBlock  // privilege level { methods }
  / AliasBlock  // alias blocks can appear in commands
  / ManBlock
  / ShowBlock
  / Comment { return null; }

// Bootlevel modes like clear-modes, maintenance, normal
BootlevelMode
  = $([a-zA-Z][a-zA-Z0-9\-]*)

ManBlock
  = "man" __ command:StringLiteral _ "{" _ body:ManBodyContent _ "}" {
      return {
        type: 'ManBlock',
        loc: location(),
        command: command,
        ...body
      };
    }

ManBodyContent
  = items:(ManBodyItem _)* {
      const result = {};
      for (const [item] of items) {
        if (item == null) continue;
        Object.assign(result, item);
      }
      return result;
    }

ManBodyItem
  = ManArgsBlock { return { args: arguments[0] }; }
  / Comment { return null; }

// Man args have a special format, capture as raw content
ManArgsBlock
  = "args" _ "{" content:ManArgsContent "}" {
      return {
        type: 'ManArgsBlock',
        loc: location(),
        raw: content
      };
    }

ManArgsContent
  = chars:ManArgsChar* { return chars.join(''); }

ManArgsChar
  = [^{}]
  / "{" chars:ManArgsContent "}" { return '{' + chars + '}'; }

ShowBlock
  = showType:("show-instance" / "show" "-" [a-zA-Z0-9_-]+ / "show") _
    privBlock:("{" _ AttributeTokens _ "}")? _
    "{" _ fields:ShowFieldList _ "}" _
    format:ShowFormat? {
      const showTypeStr = Array.isArray(showType) ? showType.flat().join('') : showType;
      const privilege = privBlock ? privBlock[2].find(t =>
        ['admin', 'advanced', 'diagnostic', 'test'].includes(t)) : null;
      return {
        type: 'ShowBlock',
        loc: location(),
        showType: showTypeStr,
        privilege: privilege,
        fields: fields,
        format: format
      };
    }

ShowFieldList
  = fields:(ShowFieldName _)* {
      return fields.map(f => f[0]);
    }

// Show field names can include dots like service-ip.address
ShowFieldName
  = $([a-zA-Z_][a-zA-Z0-9_.\-]*)

ShowFormat
  = "{" content:$[^}]* "}" {
      return {
        type: 'UiFormatBlock',
        loc: location(),
        raw: content
      };
    }

// ============================================================================
// Zephyr Block
// ============================================================================

ZephyrBlock
  = "zephyr" categoryName:(__ Identifier)? _ "{" _ content:ZephyrContent _ "}" {
      return {
        type: 'ZephyrBlock',
        loc: location(),
        category: categoryName ? {
          type: 'ZephyrCategory',
          loc: location(),
          name: categoryName[1]
        } : null,
        ...content
      };
    }

ZephyrContent
  = items:(ZephyrItem _)* {
      const result = { typedefs: [], apis: null, apiDefs: [] };
      for (const [item] of items) {
        if (item == null) continue;
        if (item.category) result.category = item.category;
        else if (item.typedef) result.typedefs.push(item.typedef);
        else if (item.apis) result.apis = item.apis;
        else if (item.help) result.help = item.help;
        else if (item.source) result.source = item.source;
        else if (item.name) result.name = item.name;
        else if (item.type === 'ZephyrApiDef') result.apiDefs.push(item);
        else if (item.raw) result.raw = (result.raw || '') + ' ' + item.raw;
      }
      if (result.raw) result.raw = result.raw.trim();
      return result;
    }

ZephyrItem
  = "category" __ name:Identifier __ description:StringLiteral _
    "{" content:BalancedBraces "}" {
      return {
        category: {
          type: 'ZephyrCategory',
          loc: location(),
          name: name,
          description: description,
          content: content
        }
      };
    }
  / "category" __ name:Identifier _ "{" _ external:"external"? _ "}" {
      return {
        category: {
          type: 'ZephyrCategory',
          loc: location(),
          name: name,
          external: external ? true : false
        }
      };
    }
  / "category" __ name:Identifier {
      return {
        category: {
          type: 'ZephyrCategory',
          loc: location(),
          name: name,
          external: false
        }
      };
    }
  / "category" __ name:StringLiteral {
      return {
        category: {
          type: 'ZephyrCategory',
          loc: location(),
          name: name
        }
      };
    }
  / ZephyrTypedef
  / ZephyrApis
  / ZephyrStandaloneApiDef  // "api NAME desc { body }" format
  / "object-description" __ desc:StringLiteral { return { objectDescription: desc }; }
  / "args" _ "{" content:BalancedBraces "}" { return { args: content }; }
  / ZephyrHelp         // Must be before ZephyrSimpleType
  / ZephyrSource       // Must be before ZephyrSimpleType
  / ZephyrName         // Must be before ZephyrSimpleType
  / ZephyrNestedBlock
  / ZephyrSimpleType
  / Comment { return null; }

// Standalone api definition: api NAME "desc" { body } or api NAME { body }
ZephyrStandaloneApiDef
  = "api" __ apiName:DottedIdentifier __ description:StringLiteral _
    "{" content:BalancedBraces "}" {
      return {
        type: 'ZephyrApiDef',
        loc: location(),
        operation: null,
        apiName: apiName,
        description: description,
        raw: content
      };
    }
  / "api" __ apiName:DottedIdentifier _
    "{" content:BalancedBraces "}" {
      return {
        type: 'ZephyrApiDef',
        loc: location(),
        operation: null,
        apiName: apiName,
        raw: content
      };
    }

// Name directive in zephyr block
ZephyrName
  = "name" __ value:Identifier {
      return { name: value };
    }

// Simple type reference like "string", "integer", "boolean" in zephyr { string }
// Also handles type expressions like "integer(0..2^32-1) native"
// And quoted type specs like "integer(0..2^64-1)"
ZephyrSimpleType
  = name:Identifier range:ZephyrTypeRange? modifiers:ZephyrTypeModifiers? !(_ "{") {
      let raw = name.name;
      if (range) raw += range;
      if (modifiers && modifiers.length > 0) raw += ' ' + modifiers.join(' ');
      return { raw: raw };
    }
  / typeSpec:StringLiteral modifiers:ZephyrTypeModifiers? {
      let raw = typeSpec.value;
      if (modifiers && modifiers.length > 0) raw += ' ' + modifiers.join(' ');
      return { raw: raw };
    }

ZephyrTypeRange
  = "(" content:$[^)]+ ")" { return '(' + content + ')'; }

// Type modifiers must not be reserved keywords
ZephyrTypeModifiers
  = mods:(__ mod:ZephyrTypeModifier { return mod; })* { return mods; }

ZephyrTypeModifier
  = !("help" / "category" / "typedef" / "apis" / "}" / "{") name:Identifier { return name.name; }

// Help directive inside zephyr block
ZephyrHelp
  = "help" __ value:StringLiteral {
      return { help: value };
    }

// Source directive in zephyr block
ZephyrSource
  = "source" __ value:StringLiteral {
      return { source: value };
    }

ZephyrTypedef
  = "typedef" __ name:Identifier __ description:StringLiteral _
    "{" _ attrs:ZephyrTypedefAttrs? _ "}" _ "{" _ fields:ZephyrFieldList _ "}" {
      return {
        typedef: {
          type: 'ZephyrTypedef',
          loc: location(),
          name: name,
          description: description,
          attributes: attrs || {},
          fields: fields
        }
      };
    }

ZephyrTypedefAttrs
  = "source" __ value:StringLiteral { return { source: value }; }
  / tokens:$[^{}]+ { return { raw: tokens.trim() }; }
  / _ { return {}; }

ZephyrFieldList
  = fields:(ZephyrField _)* {
      return fields.map(f => f[0]).filter(f => f != null);
    }

ZephyrField
  // name=alias "description" { content }
  = name:DottedIdentifier "=" alias:Identifier __ description:StringLiteral _ "{" content:NestedBraceContent "}" {
      return {
        type: 'ZephyrField',
        loc: location(),
        name: name,
        alias: alias,
        description: description,
        mapping: content.trim()
      };
    }
  / name:DottedIdentifier "=" alias:Identifier _ "{" content:NestedBraceContent "}" {
      return {
        type: 'ZephyrField',
        loc: location(),
        name: name,
        alias: alias,
        mapping: content.trim()
      };
    }
  / name:DottedIdentifier __ description:StringLiteral _ "{" content:NestedBraceContent "}" {
      return {
        type: 'ZephyrField',
        loc: location(),
        name: name,
        description: description,
        content: content.trim()
      };
    }
  // keyword name { content } - like api create-by-size { }
  / keyword:Identifier __ name:DottedIdentifier _ "{" content:NestedBraceContent "}" {
      return {
        type: 'ZephyrField',
        loc: location(),
        keyword: keyword.name,
        name: name,
        content: content.trim()
      };
    }
  / name:DottedIdentifier _ "{" content:NestedBraceContent "}" {
      return {
        type: 'ZephyrField',
        loc: location(),
        name: name,
        mapping: content.trim()
      };
    }
  / Comment { return null; }

ZephyrApis
  = "apis" _ "{" _ apis:ZephyrApiList _ "}" {
      return {
        apis: {
          type: 'ZephyrApis',
          loc: location(),
          apis: apis
        }
      };
    }

ZephyrApiList
  = apis:(ZephyrApiDef _)* {
      return apis.map(a => a[0]).filter(a => a != null);
    }

ZephyrApiDef
  = operation:Identifier "=" apiName:Identifier __ description:StringLiteral _
    "{" _ "}" {
      // API definition in apis block format (operation=name "desc" {})
      return {
        type: 'ZephyrApiDef',
        loc: location(),
        operation: operation.name,
        apiName: apiName,
        description: description
      };
    }
  / Comment { return null; }

ZephyrNestedBlock
  = keyword:Identifier __ name:DottedIdentifier _ "{" content:BalancedBraces "}" {
      return { raw: keyword.name + ' ' + name + ' { ' + content + ' }' };
    }
  / name:Identifier _ "{" content:BalancedBraces "}" {
      return { raw: name.name + ' { ' + content + ' }' };
    }

// ============================================================================
// Zapi Block
// ============================================================================

ZapiBlock
  = "zapi" _ "{" _ items:(ZapiItem _)* _ "}" {
      const result = { type: 'ZapiBlock', loc: location() };
      for (const [item] of items) {
        if (item && item.source) result.source = item.source;
        else if (item && item.name) result.name = item.name;
        else if (item && item.help) result.help = item.help;
        else if (item && item.typeRef) result.typeRef = item.typeRef;
      }
      return result;
    }

ZapiItem
  = "source" __ value:StringLiteral { return { source: value }; }
  / "name" __ value:Identifier { return { name: value }; }
  / "help" __ value:StringLiteral { return { help: value }; }
  / ZapiSimpleType
  / Comment { return null; }

// Simple type reference in zapi block (like "string", "integer")
ZapiSimpleType
  = name:Identifier !(_ "{") {
      return { typeRef: name };
    }

// ============================================================================
// Descriptions Block
// ============================================================================

DescriptionsBlock
  = "descriptions" _ "{" _ descriptions:DescriptionList _ "}" {
      return {
        type: 'DescriptionsBlock',
        loc: location(),
        descriptions: descriptions
      };
    }

DescriptionList
  = items:(FieldDescription _)* {
      return items.map(i => i[0]).filter(i => i != null);
    }

FieldDescription
  = name:FieldDescName _ "{" _ "zapi" __ value:StringLiteral _ "}" {
      return {
        type: 'FieldDescription',
        loc: location(),
        fieldName: name,
        zapi: value
      };
    }
  / name:FieldDescName _ "{" content:BalancedBraces "}" {
      return {
        type: 'FieldDescription',
        loc: location(),
        fieldName: name,
        raw: content.trim()
      };
    }
  / "%" name:Identifier _ "{" content:BalancedBraces "}" {
      return {
        type: 'SpecialDescription',
        loc: location(),
        name: '%' + name,
        raw: content.trim()
      };
    }
  / Comment { return null; }

// FieldDescName can be identifier (including dotted), quoted string, or %-prefixed
FieldDescName
  = DottedIdentifier
  / StringLiteral

// ============================================================================
// Directives
// ============================================================================

DistKeysDirective
  = "dist_keys" __ "from" __ table:Identifier {
      return {
        type: 'DistKeysDirective',
        loc: location(),
        fromTable: table
      };
    }
  / "dist_keys" __ "from" _ "{" _ tables:IdentifierList _ "}" {
      return {
        type: 'DistKeysDirective',
        loc: location(),
        fromTables: tables
      };
    }
  / "dist_keys" _ "{" _ fields:IdentifierList _ "}" {
      return {
        type: 'DistKeysDirective',
        loc: location(),
        fields: fields
      };
    }

AlternateKeysDirective
  = "alternateKeys" __ name:Identifier _ "{" _ fields:DottedIdentifierList _ "}" {
      return {
        type: 'AlternateKeysDirective',
        loc: location(),
        name: name,
        fields: fields
      };
    }

CloneFieldsDirective
  = "clone-fields" _ "{" _ table:Identifier __ spec:$[^}]+ _ "}" {
      return {
        type: 'CloneFieldsDirective',
        loc: location(),
        tableName: table,
        spec: spec.trim()
      };
    }

KeysFromBlock
  = "keys" __ "from" _ "{" _ refs:KeyReferenceList _ "}" {
      return {
        type: 'KeysFromBlock',
        loc: location(),
        references: refs
      };
    }
  / "keys" __ "from" __ table:Identifier {
      return {
        type: 'KeysFromBlock',
        loc: location(),
        fromTable: table
      };
    }
  // keys for table () { refs } - empty methods with parens
  / "keys" __ "for" __ table:Identifier _ "()" _
    "{" _ refs:KeyReferenceList _ "}" {
      return {
        type: 'KeysForBlock',
        loc: location(),
        targetTable: table,
        methods: [],
        references: refs
      };
    }
  / "keys" __ "for" __ table:Identifier _ "{" _ methods:IdentifierList _ "}" _
    "{" _ refs:KeyReferenceList _ "}" {
      return {
        type: 'KeysForBlock',
        loc: location(),
        targetTable: table,
        methods: methods,
        references: refs
      };
    }

KeyReferenceList
  = refs:(KeyReference _)* {
      return refs.map(r => r[0]).filter(r => r != null);
    }

KeyReference
  // field=alias "description" [priority] modifier
  = table:Identifier __ field:KeyRefField "=" alias:KeyFieldAlias __ desc:StringLiteral _ "[" priority:Integer "]" _ modifier:KeyRefModifier? {
      return {
        type: 'KeyReference',
        loc: location(),
        tableName: table,
        fieldName: field,
        alias: alias,
        description: desc,
        priority: priority.value,
        modifier: modifier || null
      };
    }
  // field=alias "description" modifier (no priority)
  / table:Identifier __ field:KeyRefField "=" alias:KeyFieldAlias __ desc:StringLiteral __ modifier:KeyRefModifier {
      return {
        type: 'KeyReference',
        loc: location(),
        tableName: table,
        fieldName: field,
        alias: alias,
        description: desc,
        priority: null,
        modifier: modifier
      };
    }
  // field=alias "description"
  / table:Identifier __ field:KeyRefField "=" alias:KeyFieldAlias __ desc:StringLiteral {
      return {
        type: 'KeyReference',
        loc: location(),
        tableName: table,
        fieldName: field,
        alias: alias,
        description: desc,
        priority: null
      };
    }
  // field=alias[priority] modifier
  / table:Identifier __ field:KeyRefField "=" alias:KeyFieldAlias _ "[" priority:Integer "]" _ modifier:KeyRefModifier? {
      return {
        type: 'KeyReference',
        loc: location(),
        tableName: table,
        fieldName: field,
        alias: alias,
        priority: priority.value,
        modifier: modifier || null
      };
    }
  // field[priority] "description" modifier
  / table:Identifier __ field:KeyRefField _ "[" priority:Integer "]" __ desc:StringLiteral __ modifier:KeyRefModifier {
      return {
        type: 'KeyReference',
        loc: location(),
        tableName: table,
        fieldName: field,
        description: desc,
        priority: priority.value,
        modifier: modifier
      };
    }
  // field[priority] "description" - no alias but with description (must come before field[priority] modifier)
  / table:Identifier __ field:KeyRefField _ "[" priority:Integer "]" __ desc:StringLiteral {
      return {
        type: 'KeyReference',
        loc: location(),
        tableName: table,
        fieldName: field,
        description: desc,
        priority: priority.value
      };
    }
  // field[priority] modifier
  / table:Identifier __ field:KeyRefField _ "[" priority:Integer "]" _ modifier:KeyRefModifier? {
      return {
        type: 'KeyReference',
        loc: location(),
        tableName: table,
        fieldName: field,
        priority: priority.value,
        modifier: modifier || null
      };
    }
  // field=alias modifier
  / table:Identifier __ field:KeyRefField "=" alias:KeyFieldAlias _ modifier:KeyRefModifier? {
      return {
        type: 'KeyReference',
        loc: location(),
        tableName: table,
        fieldName: field,
        alias: alias,
        priority: null,
        modifier: modifier || null
      };
    }
  // field "description" modifier - no alias, no priority
  / table:Identifier __ field:KeyRefField __ desc:StringLiteral __ modifier:KeyRefModifier {
      return {
        type: 'KeyReference',
        loc: location(),
        tableName: table,
        fieldName: field,
        description: desc,
        priority: null,
        modifier: modifier
      };
    }
  // field "description" - no alias, no priority
  / table:Identifier __ field:KeyRefField __ desc:StringLiteral {
      return {
        type: 'KeyReference',
        loc: location(),
        tableName: table,
        fieldName: field,
        description: desc,
        priority: null
      };
    }
  // field modifier only
  / table:Identifier __ field:KeyRefField __ modifier:KeyRefModifier {
      return {
        type: 'KeyReference',
        loc: location(),
        tableName: table,
        fieldName: field,
        priority: null,
        modifier: modifier
      };
    }
  // field only
  / table:Identifier __ field:KeyRefField {
      return {
        type: 'KeyReference',
        loc: location(),
        tableName: table,
        fieldName: field,
        priority: null
      };
    }
  // table only - no field specified (inherits all keys)
  / table:Identifier {
      return {
        type: 'KeyReference',
        loc: location(),
        tableName: table,
        priority: null
      };
    }
  / Comment { return null; }

// Key reference field name - can have -/~/! prefixes in any combination
KeyRefField
  = "~!" name:KeyRefFieldName { return '~!' + name; }
  / "!~" name:KeyRefFieldName { return '!~' + name; }
  / "~" name:KeyRefFieldName { return '~' + name; }
  / "!" name:KeyRefFieldName { return '!' + name; }
  / "-" name:KeyRefFieldName { return '-' + name; }
  / "=" name:KeyRefFieldName { return '=' + name; }
  / name:KeyRefFieldName { return name; }
  / "-" { return '-'; }

// Key reference field name can include dots and colons
KeyRefFieldName
  = $([a-zA-Z_][a-zA-Z0-9_\-:.]*)

// Key field alias can include dots for table.field references and chains like field=alias=name
KeyFieldAlias
  = $([a-zA-Z0-9_.\-]+ ("=" [a-zA-Z0-9_.\-]+)*)

// Key reference modifier: key, key-forsort, key-nocreate, etc.
KeyRefModifier
  = $("key-forsort" / "key-required" / "key-nocreate" / "key")

InheritFromBlock
  = "inherit_from" _ "{" _ tables:IdentifierList _ "}" {
      return {
        type: 'InheritFromBlock',
        loc: location(),
        tables: tables
      };
    }

ObjectReplicationBlock
  = "object-replication" _ "{" _ content:ObjectReplicationContent _ "}" {
      return {
        type: 'ObjectReplicationBlock',
        loc: location(),
        ...content
      };
    }

ObjectReplicationContent
  = items:(ObjectReplicationItem _)* {
      const result = {};
      for (const [item] of items) {
        if (item) Object.assign(result, item);
      }
      return result;
    }

ObjectReplicationItem
  = "none" { return { none: true }; }
  / "file-based" { return { fileBased: true }; }
  / "domain" _ "{" _ fields:IdentifierList _ "}" { return { domain: fields }; }
  / "domain-instance-uuid" _ "{" _ fields:DottedIdentifierList _ "}" { return { domainInstanceUuid: fields }; }
  / "required-fields" _ "{" _ fields:DottedIdentifierList _ "}" { return { requiredFields: fields }; }
  / "excluded-fields" _ "{" _ fields:DottedIdentifierList _ "}" { return { excludedFields: fields }; }
  / "required-methods" _ "{" _ fields:IdentifierList _ "}" { return { requiredMethods: fields }; }
  / "excluded-intrinsics" _ "{" _ fields:IdentifierList _ "}" { return { excludedIntrinsics: fields }; }
  / "depends-on" _ "{" _ fields:IdentifierList _ "}" { return { dependsOn: fields }; }
  / Comment { return null; }

// Dotted identifier list for object-replication fields
DottedIdentifierList
  = first:DottedNameOrAlias rest:(_ DottedNameOrAlias)* { return [first, ...rest.map(r => r[1])]; }
  / "" { return []; }

DottedNameOrAlias
  = name:DottedName "=" alias:DottedName { return { name, alias }; }
  / DottedName

// Dotted identifier/field name that can start with digit and include dots, colons
// May have trailing dot (e.g. "name.")
DottedName
  = $([a-zA-Z0-9_][a-zA-Z0-9_\-]* ([.:] [a-zA-Z0-9_][a-zA-Z0-9_\-]*)* "."?)

ValuesBlock
  = "values" _ "{" _ refs:ValueReferenceList _ "}" {
      return {
        type: 'ValuesBlock',
        loc: location(),
        references: refs
      };
    }

ValueReferenceList
  = refs:(ValueReferenceItem _)* {
      return refs.map(r => r[0]).filter(r => r != null);
    }

ValueReferenceItem
  = ValueGroupStart   // table (field
  / ValueGroupContinue  // table |field
  / ValueGroupEnd     // table field)
  / table:Identifier __ ".ALL" { return { type: 'ValueReference', loc: location(), tableName: table, fieldSpec: '.ALL', sameAsAbove: true }; }  // table .ALL
  / ValueReference
  / Comment { return null; }

// Group start: table (field[pri]
ValueGroupStart
  = table:Identifier __ "(" field:ValueFieldName _ "[" priority:Integer "]" {
      return {
        type: 'ValueReference',
        loc: location(),
        tableName: table,
        fieldSpec: field,
        priority: priority.value,
        groupStart: true
      };
    }
  // table (field=alias
  / table:Identifier __ "(" field:ValueFieldName "=" alias:ValueFieldAlias {
      return {
        type: 'ValueReference',
        loc: location(),
        tableName: table,
        fieldSpec: field,
        alias: alias,
        groupStart: true
      };
    }
  / table:Identifier __ "(" field:ValueFieldName {
      return {
        type: 'ValueReference',
        loc: location(),
        tableName: table,
        fieldSpec: field,
        groupStart: true
      };
    }

// Group continue: table |field[pri]
ValueGroupContinue
  = table:Identifier __ "|" field:ValueFieldName _ "[" priority:Integer "]" {
      return {
        type: 'ValueReference',
        loc: location(),
        tableName: table,
        fieldSpec: field,
        priority: priority.value,
        groupContinue: true
      };
    }
  // Group continue AND end: table |field)
  / table:Identifier __ "|" field:ValueFieldName ")" {
      return {
        type: 'ValueReference',
        loc: location(),
        tableName: table,
        fieldSpec: field,
        groupContinue: true,
        groupEnd: true
      };
    }
  / table:Identifier __ "|" field:ValueFieldName {
      return {
        type: 'ValueReference',
        loc: location(),
        tableName: table,
        fieldSpec: field,
        groupContinue: true
      };
    }

// Group end: table field[pri]) or table field)
ValueGroupEnd
  = table:Identifier __ field:ValueFieldName _ "[" priority:Integer "]" ")" {
      return {
        type: 'ValueReference',
        loc: location(),
        tableName: table,
        fieldSpec: field,
        priority: priority.value,
        groupEnd: true
      };
    }
  // field=alias)
  / table:Identifier __ field:ValueFieldName "=" alias:ValueFieldAlias ")" {
      return {
        type: 'ValueReference',
        loc: location(),
        tableName: table,
        fieldSpec: field,
        alias: alias,
        groupEnd: true
      };
    }
  / table:Identifier __ field:ValueFieldName ")" {
      return {
        type: 'ValueReference',
        loc: location(),
        tableName: table,
        fieldSpec: field,
        groupEnd: true
      };
    }

ValueReference
  // field=alias "desc" [priority]
  = table:Identifier __ field:ValueFieldName "=" alias:ValueFieldAlias __ desc:StringLiteral _ "[" priority:Integer "]" {
      return {
        type: 'ValueReference',
        loc: location(),
        tableName: table,
        fieldSpec: field,
        alias: alias,
        description: desc,
        priority: priority.value
      };
    }
  // field=alias "desc"
  / table:Identifier __ field:ValueFieldName "=" alias:ValueFieldAlias __ desc:StringLiteral {
      return {
        type: 'ValueReference',
        loc: location(),
        tableName: table,
        fieldSpec: field,
        alias: alias,
        description: desc
      };
    }
  // field=alias[priority] "description" (must come before field=alias[priority])
  / table:Identifier __ field:ValueFieldName "=" alias:ValueFieldAlias _ "[" priority:Integer "]" __ desc:StringLiteral {
      return {
        type: 'ValueReference',
        loc: location(),
        tableName: table,
        fieldSpec: field,
        alias: alias,
        priority: priority.value,
        description: desc
      };
    }
  // field=alias[priority]
  / table:Identifier __ field:ValueFieldName "=" alias:ValueFieldAlias _ "[" priority:Integer "]" {
      return {
        type: 'ValueReference',
        loc: location(),
        tableName: table,
        fieldSpec: field,
        alias: alias,
        priority: priority.value
      };
    }
  // field[priority] "description" - no alias but with description (must come before field[priority])
  / table:Identifier __ field:("ALL" / ValueFieldName) _ "[" priority:Integer "]" __ desc:StringLiteral {
      return {
        type: 'ValueReference',
        loc: location(),
        tableName: table,
        fieldSpec: typeof field === 'string' ? field : field,
        description: desc,
        priority: priority.value
      };
    }
  // field[priority]
  / table:Identifier __ field:("ALL" / ValueFieldName) _ "[" priority:Integer "]" {
      return {
        type: 'ValueReference',
        loc: location(),
        tableName: table,
        fieldSpec: typeof field === 'string' ? field : field,
        priority: priority.value
      };
    }
  // field=alias
  / table:Identifier __ field:ValueFieldName "=" alias:ValueFieldAlias {
      return {
        type: 'ValueReference',
        loc: location(),
        tableName: table,
        fieldSpec: field,
        alias: alias
      };
    }
  // field "desc" (no alias)
  / table:Identifier __ field:("ALL" / ValueFieldName) __ desc:StringLiteral {
      return {
        type: 'ValueReference',
        loc: location(),
        tableName: table,
        fieldSpec: typeof field === 'string' ? field : field,
        description: desc
      };
    }
  // field only
  / table:Identifier __ field:("ALL" / ValueFieldName) {
      return {
        type: 'ValueReference',
        loc: location(),
        tableName: table,
        fieldSpec: typeof field === 'string' ? field : field
      };
    }
  / Comment { return null; }

// Value field names can start with prefix markers like ~ or - or ! in any combination
ValueFieldName
  = prefix:$([-~!]*) name:$([a-zA-Z_][a-zA-Z0-9_.\-:]*) { return prefix + name; }

// Value field alias can include dots, colons, and chains like field=alias=name
ValueFieldAlias
  = $([a-zA-Z0-9_.\-:]+ ("=" [a-zA-Z0-9_.\-:]+)*)

WritePrivilegeDirective
  // write-privilege level:feature { fields }
  = "write-privilege" __ level:("admin" / "advanced" / "diagnostic" / "test") ":" feature:Identifier _
    "{" _ fields:DottedIdentifierList _ "}" {
      return {
        type: 'WritePrivilegeDirective',
        loc: location(),
        privilege: level,
        feature: feature,
        fields: fields
      };
    }
  // write-privilege level { fields }
  / "write-privilege" __ privilege:("admin" / "advanced" / "diagnostic" / "test") _
    "{" _ fields:DottedIdentifierList _ "}" {
      return {
        type: 'WritePrivilegeDirective',
        loc: location(),
        privilege: privilege,
        fields: fields
      };
    }
  // write-privilege { spec spec ... } { fields }
  / "write-privilege" _ "{" _ specs:PrivilegeSpecList _ "}" _
    "{" _ fields:DottedIdentifierList _ "}" {
      return {
        type: 'WritePrivilegeDirective',
        loc: location(),
        specs: specs,
        fields: fields
      };
    }

PrivilegeBlock
  = "privilege" __ privilege:("admin" / "advanced" / "diagnostic" / "test") _
    "{" _ fields:DottedIdentifierList _ "}" {
      return {
        type: 'PrivilegeBlock',
        loc: location(),
        privilege: privilege,
        fields: fields
      };
    }
  // Inline form: privilege level method (no braces)
  / "privilege" __ privilege:("admin" / "advanced" / "diagnostic" / "test") __ method:Identifier {
      return {
        type: 'PrivilegeBlock',
        loc: location(),
        privilege: privilege,
        fields: [method.name]
      };
    }
  // Form: privilege level:feature { fields }
  / "privilege" __ spec:PrivilegeSpec _ "{" _ fields:DottedIdentifierList _ "}" {
      return {
        type: 'PrivilegeBlock',
        loc: location(),
        specs: [spec],
        fields: fields
      };
    }
  // Extended form: privilege { spec spec... } { fields }
  / "privilege" _ "{" _ specs:PrivilegeSpecList _ "}" _
    "{" _ fields:DottedIdentifierList _ "}" {
      return {
        type: 'PrivilegeBlock',
        loc: location(),
        specs: specs,
        fields: fields
      };
    }

PrivilegeSpecList
  = first:PrivilegeSpec rest:(_ PrivilegeSpec)* {
      return [first, ...rest.map(r => r[1])];
    }

PrivilegeSpec
  = level:("admin" / "advanced" / "diagnostic" / "test") ":" feature:Identifier {
      return { level: level, feature: feature };
    }
  / level:("admin" / "advanced" / "diagnostic" / "test") {
      return { level: level };
    }

LicenseDirective
  = "license" _ "{" _ licenses:IdentifierList _ "}" {
      return {
        type: 'LicenseDirective',
        loc: location(),
        licenses: licenses
      };
    }

// ============================================================================
// SQL View Directives
// ============================================================================

AttachDirective
  = "ATTACH" __ database:StringLiteral {
      return {
        type: 'AttachDirective',
        loc: location(),
        database: database
      };
    }

ViewQueryDirective
  = "VIEW" __ query:StringLiteral {
      return {
        type: 'ViewQueryDirective',
        loc: location(),
        query: query
      };
    }
  // VIEW { raw SQL content }
  / "VIEW" _ "{" content:NestedBraceContent "}" {
      return {
        type: 'ViewQueryDirective',
        loc: location(),
        query: content.trim()
      };
    }

SqlFieldsBlock
  = "sql-fields" _ "{" _ fields:SqlFieldList _ "}" {
      return {
        type: 'SqlFieldsBlock',
        loc: location(),
        fields: fields
      };
    }

SqlDerivedFieldsBlock
  = "sql-derived-fields" _ "{" _ fields:SqlFieldList _ "}" {
      return {
        type: 'SqlDerivedFieldsBlock',
        loc: location(),
        fields: fields
      };
    }

SqlFieldList
  = fields:(SqlFieldItem _)* {
      return fields.map(f => f[0]).filter(f => f != null);
    }

SqlFieldItem
  = SqlDottedFieldDeclaration  // volume.name "Description" type role[priority]
  / SqlFieldReference
  / SqlAliasedFieldDeclaration  // name=alias "Description" type role[priority]
  / SqlSimpleFieldDeclaration
  / Comment { return null; }

// Dotted field declaration: table.field "description" type role[priority]
// Can have ~ prefix for deprecated
SqlDottedFieldDeclaration
  = deprecated:"~"? optional:"!"? name:DottedIdentifier __ description:StringLiteral __ fieldType:FieldTypeOrIdentifier __
    role:SqlFieldRole priority:FieldPriority? {
      return {
        type: 'SqlDottedFieldDeclaration',
        loc: location(),
        deprecated: deprecated === '~',
        optional: optional === '!',
        name: name,
        description: description,
        fieldType: fieldType,
        role: role,
        priority: priority ? priority.value : undefined
      };
    }

// Aliased field declaration: name=alias "description" type role[priority]
SqlAliasedFieldDeclaration
  = deprecated:"~"? optional:"!"? name:Identifier "=" useUiName:"^"? alias:DottedIdentifier __ description:StringLiteral __ fieldType:FieldTypeOrIdentifier __
    role:SqlFieldRole priority:FieldPriority? {
      return {
        type: 'SqlSimpleFieldDeclaration',
        loc: location(),
        deprecated: deprecated === '~',
        optional: optional === '!',
        name: name,
        alias: alias,
        useUiName: useUiName === '^',
        description: description,
        fieldType: fieldType,
        role: role,
        priority: priority ? priority.value : undefined
      };
    }

// Simple field declaration in sql-derived-fields: name "description" type role[priority]
// Can have ~ prefix for deprecated
SqlSimpleFieldDeclaration
  = deprecated:"~"? optional:"!"? name:Identifier __ description:StringLiteral __ fieldType:FieldTypeOrIdentifier __
    role:SqlFieldRole priority:FieldPriority? {
      return {
        type: 'SqlSimpleFieldDeclaration',
        loc: location(),
        deprecated: deprecated === '~',
        optional: optional === '!',
        name: name,
        description: description,
        fieldType: fieldType,
        role: role,
        priority: priority ? priority.value : undefined
      };
    }

SqlFieldRole
  = $("key-forsort" / "key-required" / "key" / "read" / "write" / "modify-noread" / "modify" / "create-noread" / "create" / "default" / "in" / "out" / "none" / "noread")

FieldTypeOrIdentifier
  = FieldType
  / name:Identifier { return name; }

SqlFieldReference
  // table.field=alias.table.field
  = lhs:SqlDottedRef "=" rhs:SqlDottedRef {
      return {
        type: 'SqlFieldReference',
        loc: location(),
        source: lhs,
        alias: rhs
      };
    }
  // simple table.field
  / ref:SqlDottedRef {
      return {
        type: 'SqlFieldReference',
        loc: location(),
        ...ref
      };
    }
  / Comment { return null; }

// Dotted reference like table.field or view.table.field (optional trailing dot)
SqlDottedRef
  = parts:$(Identifier ("." Identifier)+ "."?) {
      const names = parts.replace(/\.$/, '').split('.');
      return {
        tableName: names.slice(0, -1).join('.'),
        fieldName: names[names.length - 1]
      };
    }

// ============================================================================
// Identifier List
// ============================================================================

IdentifierList
  = first:Identifier rest:(_ Identifier)* {
      return [first, ...rest.map(r => r[1])];
    }
  / "" { return []; }

StringList
  = first:StringLiteral rest:(_ StringLiteral)* {
      return [first, ...rest.map(r => r[1])];
    }
  / "" { return []; }

// ============================================================================
// Basic Tokens
// ============================================================================

Identifier
  = name:$([a-zA-Z_][a-zA-Z0-9_-]*) {
      return {
        type: 'Identifier',
        loc: location(),
        name: name
      };
    }

StringLiteral
  = '"' chars:DoubleStringChar* '"' {
      const value = chars.join('');
      return {
        type: 'StringLiteral',
        loc: location(),
        value: value,
        raw: '"' + value + '"'
      };
    }

DoubleStringChar
  = '\\' char:. { return '\\' + char; }
  / [^"\\]

Integer
  = digits:$[0-9]+ {
      return {
        type: 'NumericLiteral',
        loc: location(),
        value: parseInt(digits, 10),
        raw: digits
      };
    }

SignedInteger
  = sign:"-"? digits:$[0-9]+ {
      const value = parseInt((sign || '') + digits, 10);
      return value;
    }

// ============================================================================
// Comments
// ============================================================================

Comment
  = LineComment
  / BlockComment
  / PreprocessorDirective

LineComment
  = "//" content:$[^\n\r]* {
      return {
        type: 'LineComment',
        loc: location(),
        value: content
      };
    }

// C-style preprocessor directives (#ifdef, #endif, #ifndef, #define, etc.)
PreprocessorDirective
  = "#" content:$[^\n\r]* {
      return {
        type: 'PreprocessorDirective',
        loc: location(),
        value: content
      };
    }

BlockComment
  = "/*" content:$(!"*/" .)* "*/" {
      return {
        type: 'BlockComment',
        loc: location(),
        value: content
      };
    }

PathComment
  = "//" _ [a-zA-Z]+ "/" [^\n\r]* { return null; }

// ============================================================================
// Whitespace
// ============================================================================

_  "whitespace"
  = (WhiteSpace / LineTerminator / LineContinuation / Comment)*

__ "mandatory whitespace"
  = (WhiteSpace / LineTerminator / LineContinuation / Comment)+

WhiteSpace
  = [ \t]

LineTerminator
  = [\n\r]

LineContinuation
  = "\\" LineTerminator

// ============================================================================
// Helpers
// ============================================================================

BalancedBraces
  = chars:(BalancedBraceChar / "{" BalancedBraces "}")* { return chars.flat().join(''); }

BalancedBraceChar
  = [^{}]+
