/** Escape HTML trước khi render — nội dung đến từ LLM nên không thể tin tuyệt đối. */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Markdown "mini" đủ dùng cho hội thoại anime:
 * `**đậm**`, `*nghiêng*` (dùng cho hành động), `` `code` ``, ```khối code```, xuống dòng.
 */
export function renderRich(text: string): string {
    let html = escapeHtml(text.trim());
    html = html.replace(
        /```([\s\S]*?)```/g,
        (_match, code: string) => `<pre class="md-code">${code.trim()}</pre>`,
    );
    html = html.replace(/`([^`\n]+)`/g, '<code class="md-inline">$1</code>');
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*\n]+)\*/g, '<em class="md-action">$1</em>');
    html = html.replace(/\n{2,}/g, '</p><p>');
    html = html.replace(/\n/g, '<br/>');
    return html;
}
