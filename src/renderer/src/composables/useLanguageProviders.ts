import * as monaco from 'monaco-editor'

let registered = false

export function registerLanguageProviders(): void {
  if (registered) return
  registered = true

  registerPython()
  registerShell()
  registerMarkdown()
  registerCpp()
}

// ========================================
// Python
// ========================================
function registerPython(): void {
  const keywords = [
    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
    'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
    'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
    'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
    'try', 'while', 'with', 'yield'
  ]

  const builtins = [
    'print', 'len', 'range', 'type', 'int', 'str', 'float', 'list', 'dict',
    'set', 'tuple', 'bool', 'input', 'open', 'file', 'map', 'filter',
    'zip', 'enumerate', 'sorted', 'reversed', 'any', 'all', 'abs', 'max',
    'min', 'sum', 'round', 'isinstance', 'issubclass', 'hasattr', 'getattr',
    'setattr', 'delattr', 'super', 'property', 'staticmethod', 'classmethod',
    'ValueError', 'TypeError', 'KeyError', 'IndexError', 'AttributeError',
    'ImportError', 'FileNotFoundError', 'RuntimeError', 'StopIteration',
    'Exception', 'BaseException', 'OSError', 'IOError',
    '__init__', '__str__', '__repr__', '__len__', '__getitem__', '__setitem__',
    '__enter__', '__exit__', '__iter__', '__next__', '__call__',
  ]

  const modules = [
    'os', 'sys', 'json', 'math', 'random', 'datetime', 'time', 'pathlib',
    'collections', 'itertools', 'functools', 'typing', 'dataclasses',
    'asyncio', 'threading', 'subprocess', 'shutil', 're', 'logging',
    'argparse', 'unittest', 'pytest', 'requests', 'numpy', 'pandas',
    'flask', 'django', 'fastapi', 'pydantic', 'sqlalchemy', 'torch',
  ]

  const snippets = [
    { label: 'def', insert: 'def ${1:function_name}(${2:params}):\n\t${3:pass}', doc: 'Define a function' },
    { label: 'class', insert: 'class ${1:ClassName}:\n\tdef __init__(self${2:, params}):\n\t\t${3:pass}', doc: 'Define a class' },
    { label: 'if', insert: 'if ${1:condition}:\n\t${2:pass}', doc: 'If statement' },
    { label: 'for', insert: 'for ${1:item} in ${2:iterable}:\n\t${3:pass}', doc: 'For loop' },
    { label: 'with', insert: 'with ${1:expression} as ${2:var}:\n\t${3:pass}', doc: 'With statement' },
    { label: 'try', insert: 'try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:e}:\n\t${4:raise}', doc: 'Try/except block' },
    { label: 'ifmain', insert: 'if __name__ == "__main__":\n\t${1:main()}', doc: 'Main guard' },
    { label: 'list_comp', insert: '[${1:x} for ${2:x} in ${3:iterable}]', doc: 'List comprehension' },
    { label: 'dict_comp', insert: '{${1:k}: ${2:v} for ${3:k}, ${4:v} in ${5:items}}', doc: 'Dict comprehension' },
    { label: 'lambda', insert: 'lambda ${1:x}: ${2:x}', doc: 'Lambda expression' },
    { label: 'async_def', insert: 'async def ${1:function_name}(${2:params}):\n\t${3:pass}', doc: 'Async function' },
  ]

  registerProvider('python', keywords, builtins, modules, snippets)
}

// ========================================
// Shell / Bash
// ========================================
function registerShell(): void {
  const keywords = [
    'if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'while',
    'do', 'done', 'in', 'function', 'select', 'until', 'return', 'exit',
    'break', 'continue', 'local', 'export', 'readonly', 'declare',
    'typeset', 'unset', 'shift', 'source', 'eval', 'exec', 'trap',
  ]

  const builtins = [
    'echo', 'printf', 'read', 'cd', 'pwd', 'ls', 'cp', 'mv', 'rm',
    'mkdir', 'rmdir', 'touch', 'cat', 'head', 'tail', 'grep', 'sed',
    'awk', 'find', 'sort', 'uniq', 'wc', 'cut', 'tr', 'xargs',
    'chmod', 'chown', 'ln', 'tar', 'gzip', 'gunzip', 'zip', 'unzip',
    'curl', 'wget', 'ssh', 'scp', 'rsync', 'git', 'docker', 'npm',
    'pnpm', 'yarn', 'node', 'python', 'pip', 'make', 'cmake',
    'ps', 'kill', 'top', 'htop', 'df', 'du', 'free', 'mount',
    'systemctl', 'journalctl', 'apt', 'brew', 'yum', 'dnf',
    'test', 'true', 'false', 'set', 'env', 'which', 'type', 'alias',
  ]

  const variables = [
    '$HOME', '$PATH', '$USER', '$SHELL', '$PWD', '$OLDPWD',
    '$?', '$$', '$!', '$#', '$@', '$*', '$0', '$1',
    '$EDITOR', '$TERM', '$LANG', '$LC_ALL',
  ]

  const snippets = [
    { label: 'if', insert: 'if [ ${1:condition} ]; then\n\t${2:command}\nfi', doc: 'If statement' },
    { label: 'if-else', insert: 'if [ ${1:condition} ]; then\n\t${2:command}\nelse\n\t${3:command}\nfi', doc: 'If-else' },
    { label: 'for', insert: 'for ${1:i} in ${2:items}; do\n\t${3:command}\ndone', doc: 'For loop' },
    { label: 'while', insert: 'while ${1:condition}; do\n\t${2:command}\ndone', doc: 'While loop' },
    { label: 'function', insert: '${1:function_name}() {\n\t${2:command}\n}', doc: 'Function' },
    { label: 'case', insert: 'case ${1:variable} in\n\t${2:pattern})\n\t\t${3:command}\n\t\t;;\n\t*)\n\t\t${4:default}\n\t\t;;\nesac', doc: 'Case statement' },
    { label: 'shebang', insert: '#!/usr/bin/env bash\nset -euo pipefail\n\n${1:}', doc: 'Bash script header' },
  ]

  for (const lang of ['shell', 'shellscript']) {
    registerProvider(lang, keywords, builtins, variables, snippets)
  }
}

// ========================================
// Markdown
// ========================================
function registerMarkdown(): void {
  const snippets = [
    { label: 'h1', insert: '# ${1:Heading}', doc: 'Heading 1' },
    { label: 'h2', insert: '## ${1:Heading}', doc: 'Heading 2' },
    { label: 'h3', insert: '### ${1:Heading}', doc: 'Heading 3' },
    { label: 'bold', insert: '**${1:text}**', doc: 'Bold text' },
    { label: 'italic', insert: '*${1:text}*', doc: 'Italic text' },
    { label: 'code', insert: '`${1:code}`', doc: 'Inline code' },
    { label: 'codeblock', insert: '```${1:language}\n${2:code}\n```', doc: 'Code block' },
    { label: 'link', insert: '[${1:text}](${2:url})', doc: 'Link' },
    { label: 'image', insert: '![${1:alt}](${2:url})', doc: 'Image' },
    { label: 'table', insert: '| ${1:Header} | ${2:Header} |\n|---|---|\n| ${3:Cell} | ${4:Cell} |', doc: 'Table' },
    { label: 'checkbox', insert: '- [ ] ${1:Task}', doc: 'Checkbox' },
    { label: 'blockquote', insert: '> ${1:text}', doc: 'Blockquote' },
    { label: 'hr', insert: '---', doc: 'Horizontal rule' },
    { label: 'details', insert: '<details>\n<summary>${1:Summary}</summary>\n\n${2:Content}\n\n</details>', doc: 'Collapsible section' },
    { label: 'footnote', insert: '[^${1:id}]: ${2:text}', doc: 'Footnote' },
  ]

  registerProvider('markdown', [], [], [], snippets)
}

// ========================================
// C / C++
// ========================================
function registerCpp(): void {
  const cKeywords = [
    'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do',
    'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if',
    'inline', 'int', 'long', 'register', 'restrict', 'return', 'short',
    'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union',
    'unsigned', 'void', 'volatile', 'while', '_Bool', '_Complex', '_Imaginary',
  ]

  const cppKeywords = [
    ...cKeywords,
    'alignas', 'alignof', 'bool', 'catch', 'class', 'constexpr', 'consteval',
    'constinit', 'co_await', 'co_return', 'co_yield', 'decltype', 'delete',
    'dynamic_cast', 'explicit', 'export', 'false', 'friend', 'mutable',
    'namespace', 'new', 'noexcept', 'nullptr', 'operator', 'override',
    'private', 'protected', 'public', 'reinterpret_cast', 'requires',
    'static_assert', 'static_cast', 'template', 'this', 'throw', 'true',
    'try', 'typeid', 'typename', 'using', 'virtual', 'concept', 'module',
  ]

  const builtins = [
    'printf', 'scanf', 'malloc', 'calloc', 'realloc', 'free',
    'memcpy', 'memset', 'memmove', 'strcmp', 'strncmp', 'strlen',
    'strcpy', 'strncpy', 'strcat', 'strncat', 'strstr', 'sprintf',
    'fprintf', 'fopen', 'fclose', 'fread', 'fwrite', 'fgets', 'fputs',
    'exit', 'abort', 'atexit', 'atoi', 'atof', 'atol',
    'std::cout', 'std::cin', 'std::cerr', 'std::endl',
    'std::string', 'std::vector', 'std::map', 'std::unordered_map',
    'std::set', 'std::unordered_set', 'std::pair', 'std::tuple',
    'std::shared_ptr', 'std::unique_ptr', 'std::weak_ptr', 'std::make_shared',
    'std::move', 'std::forward', 'std::swap', 'std::sort', 'std::find',
    'std::begin', 'std::end', 'std::array', 'std::deque', 'std::list',
    'std::optional', 'std::variant', 'std::any', 'std::function',
    'std::thread', 'std::mutex', 'std::lock_guard', 'std::async', 'std::future',
  ]

  const headers = [
    'stdio.h', 'stdlib.h', 'string.h', 'math.h', 'time.h', 'assert.h',
    'ctype.h', 'errno.h', 'float.h', 'limits.h', 'signal.h', 'stdarg.h',
    'iostream', 'fstream', 'sstream', 'string', 'vector', 'map', 'set',
    'unordered_map', 'unordered_set', 'algorithm', 'numeric', 'memory',
    'functional', 'thread', 'mutex', 'chrono', 'filesystem', 'optional',
    'variant', 'any', 'tuple', 'array', 'deque', 'list', 'queue', 'stack',
  ]

  const snippets = [
    { label: 'main', insert: 'int main(int argc, char *argv[]) {\n\t${1:}\n\treturn 0;\n}', doc: 'Main function' },
    { label: 'class', insert: 'class ${1:ClassName} {\npublic:\n\t${1:ClassName}();\n\t~${1:ClassName}();\n\nprivate:\n\t${2:}\n};', doc: 'Class definition' },
    { label: 'for', insert: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${3:}\n}', doc: 'For loop' },
    { label: 'foreach', insert: 'for (const auto& ${1:item} : ${2:container}) {\n\t${3:}\n}', doc: 'Range-based for' },
    { label: 'if', insert: 'if (${1:condition}) {\n\t${2:}\n}', doc: 'If statement' },
    { label: 'include', insert: '#include <${1:header}>', doc: 'Include header' },
    { label: 'ifndef', insert: '#ifndef ${1:GUARD}\n#define ${1:GUARD}\n\n${2:}\n\n#endif // ${1:GUARD}', doc: 'Header guard' },
    { label: 'struct', insert: 'struct ${1:Name} {\n\t${2:}\n};', doc: 'Struct' },
    { label: 'enum', insert: 'enum class ${1:Name} {\n\t${2:}\n};', doc: 'Enum class' },
    { label: 'try', insert: 'try {\n\t${1:}\n} catch (const ${2:std::exception}& ${3:e}) {\n\t${4:}\n}', doc: 'Try/catch' },
    { label: 'lambda', insert: '[${1:}](${2:}) {\n\t${3:}\n}', doc: 'Lambda expression' },
    { label: 'template', insert: 'template <typename ${1:T}>\n${2:}', doc: 'Template' },
    { label: 'unique_ptr', insert: 'std::unique_ptr<${1:Type}> ${2:ptr} = std::make_unique<${1:Type}>(${3:});', doc: 'unique_ptr' },
  ]

  registerProvider('c', cKeywords, builtins, headers.map(h => '#include <' + h + '>'), snippets)
  registerProvider('cpp', cppKeywords, builtins, headers.map(h => '#include <' + h + '>'), snippets)
}

// ========================================
// Generic provider registration
// ========================================
function registerProvider(
  languageId: string,
  keywords: string[],
  builtins: string[],
  extras: string[],
  snippets: Array<{ label: string; insert: string; doc: string }>
): void {
  monaco.languages.registerCompletionItemProvider(languageId, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      }

      const suggestions: monaco.languages.CompletionItem[] = []

      for (const kw of keywords) {
        suggestions.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          range
        })
      }

      for (const fn of builtins) {
        suggestions.push({
          label: fn,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: fn,
          range
        })
      }

      for (const ex of extras) {
        suggestions.push({
          label: ex,
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: ex,
          range
        })
      }

      for (const sn of snippets) {
        suggestions.push({
          label: sn.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: sn.insert,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: sn.doc,
          range
        })
      }

      return { suggestions }
    }
  })
}
