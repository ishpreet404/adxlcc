# Web Mining – Cram Sheet

## UNIT I

**Web mining** = data mining on web content, links, logs. Raw data → Patterns → Knowledge.
Challenges: too large, unstructured, dynamic, relevancy.
Data mining = structured data, parent. Web mining = web data, child.

**Association rules** (`Bread → Butter`, items *together*)
- Support = both ÷ total (how common)
- Confidence = Support(AB) ÷ Support(A) (how reliable)
- Lift = Confidence ÷ Support(B) (>1 real link)
- **Apriori:** level by level, BFS. Property: subsets of frequent sets are frequent → prune. Slow, many scans.
- **Eclat:** DFS, vertical tid-lists, intersect.
- **FP-Growth:** FP-tree, no candidates, 2 scans, fastest.

**Sequential patterns / GSP** (order matters, `<a b>` ≠ `<b a>`, `(bc)` = same txn)
GSP = Apriori for sequences: count → join (drop first of s1, last of s2) → prune → count → repeat.

**ML types:** Supervised = labels (SVM, Naive Bayes, DT, KNN) · Unsupervised = no labels (K-Means) · Semi-supervised = few labels.

**3 types of web mining**
- Content = what's ON page (text mining, NLP)
- Structure = links BETWEEN pages (PageRank, HITS)
- Usage = what users DO (logs, cookies; privacy issue)

**Hub** = points OUT to many good pages. **Authority** = pointed IN by many good hubs.

**PageRank** = importance from incoming links (Google, Larry Page).
`PR(A) = (1−β) + β × Σ PR(X)/Cout(X)` for every X linking to A; β ≈ 0.8/0.85. Start every page at 1/N.
Example: PR(A) = 0.2 + 0.8 × (0.1667/4 + 0.1667/2) = 0.3

## UNIT II

**Text pre-processing:** Noise removal → Tokenize → Lowercase → Stop words → Stem → Lemmatize → POS tag.
Stemming = cut by rules, may be fake word (caring→car). Lemmatization = dictionary, real word (caring→care).

**BoW** = word counts, order lost, sparse. **VSM** = term per axis, similarity = cosine = (d1·d2) ÷ (|d1||d2|).
**TF-IDF:** TF = count ÷ words in doc; IDF = log(N ÷ docs with term); TF-IDF = TF × IDF. Common words → 0. (log1=0, log1.5=0.18, log3=0.48)

**Dimensionality reduction:** curse = more features → overfit.
Selection = keep subset (variance/correlation threshold, genetic, stepwise). Extraction = build new (PCA, LDA, t-SNE, autoencoder).
PCA: covariance → eigenvectors → keep top components.

**Inverted index:** word → list of docs (hashmap). Record-level = doc IDs; word-level = doc + position (phrase search). Build: tokenize → stop words → stem → record doc IDs. Fast search, costly updates.

**LSI:** hidden meaning via co-occurrence; handles synonyms + polysemy. Document-term matrix → SVD `A = UΣVᵀ` → keep top k. Slow, static, ignores order.

**Web spam:** Content spam (keyword stuffing) attacks relevance · Link spam (link farms) attacks PageRank · Hiding (hidden text, cloaking = different page to crawler vs user, redirection).
Detection: content/link analysis, TrustRank, ML classifier.

**SNA:** people = nodes, relations = edges. Sociogram = graph, sociomatrix = matrix.
Ego = one person + contacts (surveys, size/density). Complete = whole group (centrality).
Centrality: Degree (most links) · Closeness (reaches all fastest) · Betweenness (bridge).

**Web crawler** = bot that downloads pages, follows links. **BFS + Queue + Visited set.**
Politeness: delay + robots.txt. Freshness (HTTP HEAD) vs Age. Types: universal, focused, incremental.

**Structured data extraction:** Crawl → Clean → Extract → Structure. **Wrapper** = program that extracts data from page pattern. Manual · Wrapper induction (label few pages) · Automatic · LLM-based.

**Opinion mining** = opinions + *about what* (aspect). **Sentiment analysis** = subset, only +/−/neutral.
Types: aspect-based, emotion, summarisation, comparative, multimodal.
Techniques: NLP, lexicon-based (no training, weak on sarcasm), ML (SVM, NB), deep learning (LSTM, CNN).
Challenges: privacy, bias, sarcasm, negation.

## FORMULAS
Support = AB÷total · Confidence = S(AB)÷S(A) · Lift = Conf÷S(B) · PR(A) = (1−β)+β·ΣPR(X)/Cout(X) · TF-IDF = (count÷words) × log(N÷df) · Cosine = d1·d2 ÷ |d1||d2| · SVD: A = UΣVᵀ
