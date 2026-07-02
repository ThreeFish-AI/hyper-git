# Reference Specifications (IEEE)

> **模版准则**：[编号] 作者缩写. 姓, "文章标题," _刊名/会议名缩写 (斜体)_, 卷号, 期数, 页码, 年份.

```latex
[1] A. Author, B. Author, and C. Author, "Title of paper," *Abbrev. Title of Journal*, vol. X, no. Y, pp. XX–XX, Year.
```

**引用实践**

- **文内锚定**：采用标准上标链接形式：`描述内容<sup>[[1]](#ref1)</sup>`。
- **文献索引**：底层采用 HTML 锚点 `id` 实现跳转稳定性。

```latex
<a id="ref1"></a>[1] A. Vaswani et al., "Attention is all you need," Adv. Neural Inf. Process. Syst., vol. 30, pp. 5998–6008, 2017.
```
