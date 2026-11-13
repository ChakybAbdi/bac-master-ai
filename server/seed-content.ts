// Sample teaching content shipped with a new installation.
//
// Everything in this file was written by an AI and is stored with the
// provenance AI_GENERATED: the platform labels it as such until a teacher has
// reviewed it. The chapter list is a working structure for revision; it was not
// checked against the official programme and is stored as UNVERIFIED.
//
// Formulas use LaTeX and are written with String.raw so backslashes survive.

export interface SeedExercise {
  title_fr: string;
  title_ar: string;
  statement_fr: string;
  statement_ar: string;
  solution_fr: string;
  solution_ar: string;
  points: number;
}

export interface SeedChapter {
  title_fr: string;
  title_ar: string;
  lesson: { title_fr: string; title_ar: string; body_fr: string; body_ar: string };
  exercise: SeedExercise;
}

export const MATH_CHAPTERS: SeedChapter[] = [
  {
    title_fr: 'Suites numériques',
    title_ar: 'المتتاليات العددية',
    lesson: {
      title_fr: "L'essentiel sur les suites",
      title_ar: 'أهم ما يجب معرفته عن المتتاليات',
      body_fr: String.raw`## Suites arithmétiques et géométriques

Une suite $(u_n)$ est **arithmétique** de raison $r$ si, pour tout entier naturel $n$, $u_{n+1} = u_n + r$.

- Terme général : $u_n = u_0 + nr$ et, plus généralement, $u_n = u_p + (n - p)r$.
- Somme de $N$ termes consécutifs, de premier terme $a$ et de dernier terme $b$ : $S = N \times \dfrac{a + b}{2}$.

Une suite $(v_n)$ est **géométrique** de raison $q$ si, pour tout entier naturel $n$, $v_{n+1} = q\,v_n$.

- Terme général : $v_n = v_0\,q^n$ et, plus généralement, $v_n = v_p\,q^{n-p}$.
- Somme de $N$ termes consécutifs de premier terme $a$, pour $q \neq 1$ : $S = a \times \dfrac{1 - q^N}{1 - q}$.

## Sens de variation

On étudie le signe de $u_{n+1} - u_n$. Si cette différence est positive pour tout $n$, la suite est croissante. Si elle est négative pour tout $n$, la suite est décroissante.

## Raisonnement par récurrence

Pour démontrer qu'une propriété $P(n)$ est vraie pour tout entier $n \geq n_0$ :

1. **Initialisation.** On vérifie que $P(n_0)$ est vraie.
2. **Hérédité.** On suppose que $P(n)$ est vraie pour un entier $n \geq n_0$ et on démontre que $P(n+1)$ est vraie.
3. **Conclusion.** $P(n)$ est vraie pour tout entier $n \geq n_0$.

## Limites et convergence

- Si $-1 < q < 1$, alors $\lim\limits_{n \to +\infty} q^n = 0$. Si $q > 1$, alors $\lim\limits_{n \to +\infty} q^n = +\infty$.
- Toute suite croissante et majorée converge. Toute suite décroissante et minorée converge.

## Méthode : suite du type $u_{n+1} = a\,u_n + b$

Pour $a \neq 1$, on cherche le réel $\ell$ tel que $\ell = a\ell + b$, puis on pose $v_n = u_n - \ell$. La suite $(v_n)$ est géométrique de raison $a$, d'où $u_n = \ell + (u_0 - \ell)\,a^n$.`,
      body_ar: String.raw`## المتتاليات الحسابية والهندسية

تكون المتتالية $(u_n)$ **حسابية** أساسها $r$ إذا كان، من أجل كل عدد طبيعي $n$، $u_{n+1} = u_n + r$.

- الحد العام: $u_n = u_0 + nr$، وبصفة عامة $u_n = u_p + (n - p)r$.
- مجموع $N$ حدا متتابعا، حده الأول $a$ وحده الأخير $b$: $S = N \times \dfrac{a + b}{2}$.

تكون المتتالية $(v_n)$ **هندسية** أساسها $q$ إذا كان، من أجل كل عدد طبيعي $n$، $v_{n+1} = q\,v_n$.

- الحد العام: $v_n = v_0\,q^n$، وبصفة عامة $v_n = v_p\,q^{n-p}$.
- مجموع $N$ حدا متتابعا حده الأول $a$، من أجل $q \neq 1$: $S = a \times \dfrac{1 - q^N}{1 - q}$.

## اتجاه التغير

ندرس إشارة الفرق $u_{n+1} - u_n$. إذا كان هذا الفرق موجبا من أجل كل $n$ فالمتتالية متزايدة، وإذا كان سالبا من أجل كل $n$ فالمتتالية متناقصة.

## الاستدلال بالتراجع

للبرهان على أن خاصية $P(n)$ صحيحة من أجل كل عدد طبيعي $n \geq n_0$:

1. **المرحلة الابتدائية.** نتحقق من صحة $P(n_0)$.
2. **الوراثة.** نفرض أن $P(n)$ صحيحة من أجل عدد طبيعي $n \geq n_0$ ونبرهن أن $P(n+1)$ صحيحة.
3. **الخلاصة.** $P(n)$ صحيحة من أجل كل عدد طبيعي $n \geq n_0$.

## النهايات والتقارب

- إذا كان $-1 < q < 1$ فإن $\lim\limits_{n \to +\infty} q^n = 0$. وإذا كان $q > 1$ فإن $\lim\limits_{n \to +\infty} q^n = +\infty$.
- كل متتالية متزايدة ومحدودة من الأعلى متقاربة. كل متتالية متناقصة ومحدودة من الأسفل متقاربة.

## طريقة: متتالية من الشكل $u_{n+1} = a\,u_n + b$

من أجل $a \neq 1$، نبحث عن العدد الحقيقي $\ell$ الذي يحقق $\ell = a\ell + b$، ثم نضع $v_n = u_n - \ell$. المتتالية $(v_n)$ هندسية أساسها $a$، ومنه $u_n = \ell + (u_0 - \ell)\,a^n$.`,
    },
    exercise: {
      title_fr: 'Suite arithmético-géométrique',
      title_ar: 'متتالية من الشكل u(n+1) = a u(n) + b',
      points: 5,
      statement_fr: String.raw`Soit $(u_n)$ la suite définie par $u_0 = 1$ et, pour tout entier naturel $n$, $u_{n+1} = \dfrac{1}{2}u_n + 3$.

1. Calculer $u_1$ et $u_2$.
2. On pose $v_n = u_n - 6$. Montrer que la suite $(v_n)$ est géométrique. Préciser sa raison et son premier terme.
3. Exprimer $v_n$, puis $u_n$, en fonction de $n$.
4. Déterminer la limite de la suite $(u_n)$.`,
      statement_ar: String.raw`لتكن $(u_n)$ المتتالية المعرفة بـ $u_0 = 1$ ومن أجل كل عدد طبيعي $n$: $u_{n+1} = \dfrac{1}{2}u_n + 3$.

1. احسب $u_1$ و $u_2$.
2. نضع $v_n = u_n - 6$. بين أن المتتالية $(v_n)$ هندسية، وعين أساسها وحدها الأول.
3. اكتب $v_n$ ثم $u_n$ بدلالة $n$.
4. عين نهاية المتتالية $(u_n)$.`,
      solution_fr: String.raw`1. $u_1 = \dfrac{1}{2} \times 1 + 3 = \dfrac{7}{2}$ et $u_2 = \dfrac{1}{2} \times \dfrac{7}{2} + 3 = \dfrac{19}{4}$.

2. Pour tout entier naturel $n$ :
$$v_{n+1} = u_{n+1} - 6 = \dfrac{1}{2}u_n + 3 - 6 = \dfrac{1}{2}u_n - 3 = \dfrac{1}{2}\left(u_n - 6\right) = \dfrac{1}{2}v_n$$
La suite $(v_n)$ est donc géométrique de raison $\dfrac{1}{2}$ et de premier terme $v_0 = u_0 - 6 = -5$.

3. $v_n = -5\left(\dfrac{1}{2}\right)^n$, donc $u_n = v_n + 6 = 6 - 5\left(\dfrac{1}{2}\right)^n$.

4. Comme $-1 < \dfrac{1}{2} < 1$, on a $\lim\limits_{n \to +\infty} \left(\dfrac{1}{2}\right)^n = 0$. Donc $\lim\limits_{n \to +\infty} u_n = 6$.`,
      solution_ar: String.raw`1. $u_1 = \dfrac{1}{2} \times 1 + 3 = \dfrac{7}{2}$ و $u_2 = \dfrac{1}{2} \times \dfrac{7}{2} + 3 = \dfrac{19}{4}$.

2. من أجل كل عدد طبيعي $n$:
$$v_{n+1} = u_{n+1} - 6 = \dfrac{1}{2}u_n + 3 - 6 = \dfrac{1}{2}u_n - 3 = \dfrac{1}{2}\left(u_n - 6\right) = \dfrac{1}{2}v_n$$
إذن المتتالية $(v_n)$ هندسية أساسها $\dfrac{1}{2}$ وحدها الأول $v_0 = u_0 - 6 = -5$.

3. $v_n = -5\left(\dfrac{1}{2}\right)^n$، ومنه $u_n = v_n + 6 = 6 - 5\left(\dfrac{1}{2}\right)^n$.

4. بما أن $-1 < \dfrac{1}{2} < 1$ فإن $\lim\limits_{n \to +\infty} \left(\dfrac{1}{2}\right)^n = 0$. إذن $\lim\limits_{n \to +\infty} u_n = 6$.`,
    },
  },
  {
    title_fr: 'Fonction exponentielle',
    title_ar: 'الدالة الأسية',
    lesson: {
      title_fr: "L'essentiel sur la fonction exponentielle",
      title_ar: 'أهم ما يجب معرفته عن الدالة الأسية',
      body_fr: String.raw`## Définition

La fonction exponentielle, notée $\exp$, est l'unique fonction dérivable sur $\mathbb{R}$ qui vérifie $f' = f$ et $f(0) = 1$. On note $\exp(x) = e^x$, avec $e \approx 2{,}718$.

## Propriétés algébriques

Pour tous réels $a$ et $b$ et tout entier $n$ :

- $e^{a+b} = e^a \times e^b$
- $e^{-a} = \dfrac{1}{e^a}$ et $e^{a-b} = \dfrac{e^a}{e^b}$
- $\left(e^a\right)^n = e^{na}$

## Signe et variations

- Pour tout réel $x$, $e^x > 0$.
- La fonction exponentielle est strictement croissante sur $\mathbb{R}$. Donc $e^a = e^b$ équivaut à $a = b$, et $e^a < e^b$ équivaut à $a < b$.

## Limites à connaître

- $\lim\limits_{x \to +\infty} e^x = +\infty$ et $\lim\limits_{x \to -\infty} e^x = 0$
- $\lim\limits_{x \to +\infty} \dfrac{e^x}{x} = +\infty$ et $\lim\limits_{x \to -\infty} x\,e^x = 0$
- $\lim\limits_{x \to 0} \dfrac{e^x - 1}{x} = 1$

## Dérivation

- $\left(e^x\right)' = e^x$
- Si $u$ est une fonction dérivable, $\left(e^{u}\right)' = u'\,e^{u}$. Exemple : $\left(e^{-2x}\right)' = -2\,e^{-2x}$.`,
      body_ar: String.raw`## تعريف

الدالة الأسية، ونرمز لها بـ $\exp$، هي الدالة الوحيدة القابلة للاشتقاق على $\mathbb{R}$ والتي تحقق $f' = f$ و $f(0) = 1$. نكتب $\exp(x) = e^x$ حيث $e \approx 2{,}718$.

## الخواص الجبرية

من أجل كل عددين حقيقيين $a$ و $b$ وكل عدد صحيح $n$:

- $e^{a+b} = e^a \times e^b$
- $e^{-a} = \dfrac{1}{e^a}$ و $e^{a-b} = \dfrac{e^a}{e^b}$
- $\left(e^a\right)^n = e^{na}$

## الإشارة واتجاه التغير

- من أجل كل عدد حقيقي $x$: $e^x > 0$.
- الدالة الأسية متزايدة تماما على $\mathbb{R}$. إذن $e^a = e^b$ يكافئ $a = b$، و $e^a < e^b$ يكافئ $a < b$.

## نهايات يجب معرفتها

- $\lim\limits_{x \to +\infty} e^x = +\infty$ و $\lim\limits_{x \to -\infty} e^x = 0$
- $\lim\limits_{x \to +\infty} \dfrac{e^x}{x} = +\infty$ و $\lim\limits_{x \to -\infty} x\,e^x = 0$
- $\lim\limits_{x \to 0} \dfrac{e^x - 1}{x} = 1$

## الاشتقاق

- $\left(e^x\right)' = e^x$
- إذا كانت $u$ دالة قابلة للاشتقاق فإن $\left(e^{u}\right)' = u'\,e^{u}$. مثال: $\left(e^{-2x}\right)' = -2\,e^{-2x}$.`,
    },
    exercise: {
      title_fr: "Étude d'une fonction avec exponentielle",
      title_ar: 'دراسة دالة تتضمن الدالة الأسية',
      points: 5,
      statement_fr: String.raw`Soit $f$ la fonction définie sur $\mathbb{R}$ par $f(x) = (x - 1)\,e^x$.

1. Calculer $f'(x)$.
2. Étudier le signe de $f'(x)$ et donner le sens de variation de $f$.
3. Déterminer les limites de $f$ en $-\infty$ et en $+\infty$.
4. En déduire le minimum de $f$ sur $\mathbb{R}$.`,
      statement_ar: String.raw`لتكن $f$ الدالة المعرفة على $\mathbb{R}$ بـ $f(x) = (x - 1)\,e^x$.

1. احسب $f'(x)$.
2. ادرس إشارة $f'(x)$ واستنتج اتجاه تغير الدالة $f$.
3. عين نهايتي $f$ عند $-\infty$ وعند $+\infty$.
4. استنتج القيمة الحدية الصغرى للدالة $f$ على $\mathbb{R}$.`,
      solution_fr: String.raw`1. $f$ est un produit : $f'(x) = 1 \times e^x + (x - 1)\,e^x = x\,e^x$.

2. Comme $e^x > 0$ pour tout réel $x$, $f'(x)$ a le signe de $x$. Donc $f$ est décroissante sur $]-\infty\,;0]$ et croissante sur $[0\,;+\infty[$.

3. En $-\infty$ : $f(x) = x\,e^x - e^x$. Or $\lim\limits_{x \to -\infty} x\,e^x = 0$ et $\lim\limits_{x \to -\infty} e^x = 0$, donc $\lim\limits_{x \to -\infty} f(x) = 0$.
En $+\infty$ : $\lim\limits_{x \to +\infty} (x - 1) = +\infty$ et $\lim\limits_{x \to +\infty} e^x = +\infty$, donc $\lim\limits_{x \to +\infty} f(x) = +\infty$.

4. D'après les variations, $f$ admet un minimum en $x = 0$, égal à $f(0) = (0 - 1)\,e^0 = -1$.`,
      solution_ar: String.raw`1. الدالة $f$ جداء دالتين: $f'(x) = 1 \times e^x + (x - 1)\,e^x = x\,e^x$.

2. بما أن $e^x > 0$ من أجل كل عدد حقيقي $x$، فإن إشارة $f'(x)$ هي إشارة $x$. إذن $f$ متناقصة على $]-\infty\,;0]$ ومتزايدة على $[0\,;+\infty[$.

3. عند $-\infty$: $f(x) = x\,e^x - e^x$. لدينا $\lim\limits_{x \to -\infty} x\,e^x = 0$ و $\lim\limits_{x \to -\infty} e^x = 0$، إذن $\lim\limits_{x \to -\infty} f(x) = 0$.
عند $+\infty$: $\lim\limits_{x \to +\infty} (x - 1) = +\infty$ و $\lim\limits_{x \to +\infty} e^x = +\infty$، إذن $\lim\limits_{x \to +\infty} f(x) = +\infty$.

4. حسب اتجاه التغير، تقبل $f$ قيمة حدية صغرى عند $x = 0$ تساوي $f(0) = (0 - 1)\,e^0 = -1$.`,
    },
  },
  {
    title_fr: 'Probabilités',
    title_ar: 'الاحتمالات',
    lesson: {
      title_fr: "L'essentiel sur les probabilités conditionnelles",
      title_ar: 'أهم ما يجب معرفته عن الاحتمالات الشرطية',
      body_fr: String.raw`## Probabilité conditionnelle

Soient $A$ et $B$ deux événements avec $P(A) \neq 0$. La probabilité de $B$ sachant $A$ est

$$P_A(B) = \dfrac{P(A \cap B)}{P(A)}$$

On en déduit $P(A \cap B) = P(A) \times P_A(B)$.

## Arbre pondéré

- La somme des probabilités des branches issues d'un même nœud vaut $1$.
- La probabilité d'un chemin est le produit des probabilités de ses branches.
- La probabilité d'un événement est la somme des probabilités des chemins qui y conduisent.

## Formule des probabilités totales

Pour tout événement $A$ tel que $0 < P(A) < 1$ :

$$P(B) = P(A) \times P_A(B) + P(\overline{A}) \times P_{\overline{A}}(B)$$

## Indépendance

Deux événements $A$ et $B$ sont indépendants si $P(A \cap B) = P(A) \times P(B)$.

## Variable aléatoire

Si $X$ prend les valeurs $x_1, x_2, \dots, x_k$ avec les probabilités $p_1, p_2, \dots, p_k$ :

- Espérance : $E(X) = x_1 p_1 + x_2 p_2 + \dots + x_k p_k$
- Variance : $V(X) = E(X^2) - \left(E(X)\right)^2$
- Écart-type : $\sigma(X) = \sqrt{V(X)}$`,
      body_ar: String.raw`## الاحتمال الشرطي

ليكن $A$ و $B$ حادثتين حيث $P(A) \neq 0$. احتمال $B$ علما أن $A$ محققة هو

$$P_A(B) = \dfrac{P(A \cap B)}{P(A)}$$

ومنه $P(A \cap B) = P(A) \times P_A(B)$.

## شجرة الاحتمالات

- مجموع احتمالات الفروع الصادرة من نفس العقدة يساوي $1$.
- احتمال مسار هو جداء احتمالات فروعه.
- احتمال حادثة هو مجموع احتمالات المسارات المؤدية إليها.

## دستور الاحتمالات الكلية

من أجل كل حادثة $A$ حيث $0 < P(A) < 1$:

$$P(B) = P(A) \times P_A(B) + P(\overline{A}) \times P_{\overline{A}}(B)$$

## الاستقلال

تكون الحادثتان $A$ و $B$ مستقلتين إذا كان $P(A \cap B) = P(A) \times P(B)$.

## المتغير العشوائي

إذا كان $X$ يأخذ القيم $x_1, x_2, \dots, x_k$ باحتمالات $p_1, p_2, \dots, p_k$:

- الأمل الرياضياتي: $E(X) = x_1 p_1 + x_2 p_2 + \dots + x_k p_k$
- التباين: $V(X) = E(X^2) - \left(E(X)\right)^2$
- الانحراف المعياري: $\sigma(X) = \sqrt{V(X)}$`,
    },
    exercise: {
      title_fr: 'Tirages successifs sans remise',
      title_ar: 'سحب متتابع دون إرجاع',
      points: 5,
      statement_fr: String.raw`Une urne contient 3 boules rouges et 2 boules vertes, indiscernables au toucher. On tire successivement et sans remise deux boules de l'urne. On note $R_1$ l'événement « la première boule est rouge » et $R_2$ l'événement « la deuxième boule est rouge ».

1. Représenter la situation par un arbre pondéré.
2. Calculer la probabilité d'obtenir deux boules rouges.
3. Calculer la probabilité d'obtenir deux boules de la même couleur.
4. Sachant que la deuxième boule est rouge, quelle est la probabilité que la première le soit aussi ?`,
      statement_ar: String.raw`يحتوي كيس على 3 كريات حمراء وكريتين خضراوين لا نفرق بينها باللمس. نسحب على التوالي ودون إرجاع كريتين من الكيس. نسمي $R_1$ الحادثة «الكرية الأولى حمراء» و $R_2$ الحادثة «الكرية الثانية حمراء».

1. مثل الوضعية بشجرة احتمالات.
2. احسب احتمال الحصول على كريتين حمراوين.
3. احسب احتمال الحصول على كريتين من نفس اللون.
4. علما أن الكرية الثانية حمراء، ما احتمال أن تكون الأولى حمراء أيضا؟`,
      solution_fr: String.raw`1. Premier tirage : $P(R_1) = \dfrac{3}{5}$ et $P(\overline{R_1}) = \dfrac{2}{5}$.
Second tirage (il reste 4 boules) : $P_{R_1}(R_2) = \dfrac{2}{4} = \dfrac{1}{2}$, $P_{R_1}(\overline{R_2}) = \dfrac{1}{2}$, $P_{\overline{R_1}}(R_2) = \dfrac{3}{4}$ et $P_{\overline{R_1}}(\overline{R_2}) = \dfrac{1}{4}$.

2. $P(R_1 \cap R_2) = \dfrac{3}{5} \times \dfrac{1}{2} = \dfrac{3}{10}$.

3. Deux boules vertes : $P(\overline{R_1} \cap \overline{R_2}) = \dfrac{2}{5} \times \dfrac{1}{4} = \dfrac{1}{10}$.
Même couleur : $\dfrac{3}{10} + \dfrac{1}{10} = \dfrac{2}{5}$.

4. D'après la formule des probabilités totales : $P(R_2) = \dfrac{3}{5} \times \dfrac{1}{2} + \dfrac{2}{5} \times \dfrac{3}{4} = \dfrac{3}{10} + \dfrac{3}{10} = \dfrac{3}{5}$.
Donc $P_{R_2}(R_1) = \dfrac{P(R_1 \cap R_2)}{P(R_2)} = \dfrac{3/10}{3/5} = \dfrac{1}{2}$.`,
      solution_ar: String.raw`1. السحب الأول: $P(R_1) = \dfrac{3}{5}$ و $P(\overline{R_1}) = \dfrac{2}{5}$.
السحب الثاني (تبقى 4 كريات): $P_{R_1}(R_2) = \dfrac{2}{4} = \dfrac{1}{2}$، $P_{R_1}(\overline{R_2}) = \dfrac{1}{2}$، $P_{\overline{R_1}}(R_2) = \dfrac{3}{4}$ و $P_{\overline{R_1}}(\overline{R_2}) = \dfrac{1}{4}$.

2. $P(R_1 \cap R_2) = \dfrac{3}{5} \times \dfrac{1}{2} = \dfrac{3}{10}$.

3. كريتان خضراوان: $P(\overline{R_1} \cap \overline{R_2}) = \dfrac{2}{5} \times \dfrac{1}{4} = \dfrac{1}{10}$.
نفس اللون: $\dfrac{3}{10} + \dfrac{1}{10} = \dfrac{2}{5}$.

4. حسب دستور الاحتمالات الكلية: $P(R_2) = \dfrac{3}{5} \times \dfrac{1}{2} + \dfrac{2}{5} \times \dfrac{3}{4} = \dfrac{3}{10} + \dfrac{3}{10} = \dfrac{3}{5}$.
إذن $P_{R_2}(R_1) = \dfrac{P(R_1 \cap R_2)}{P(R_2)} = \dfrac{3/10}{3/5} = \dfrac{1}{2}$.`,
    },
  },
];

export const MATH_EXAM = {
  title_fr: "Sujet d'entraînement n° 1 : suites, exponentielle, probabilités",
  title_ar: 'موضوع تدريبي رقم 1: المتتاليات، الدالة الأسية، الاحتمالات',
  instructions_fr:
    "Sujet d'entraînement rédigé par IA, non officiel. Barème sur 20 points. Rédigez sur papier comme le jour de l'épreuve, puis comparez avec le corrigé et notez-vous exercice par exercice.",
  instructions_ar:
    'موضوع تدريبي من إعداد الذكاء الاصطناعي، غير رسمي. سلم التنقيط على 20 نقطة. حرر إجابتك على الورق كما في يوم الامتحان، ثم قارنها بالتصحيح ونقط نفسك تمرينا بتمرين.',
  exercises: [
    {
      title_fr: 'Exercice 1 : suite numérique',
      title_ar: 'التمرين الأول: متتالية عددية',
      points: 6,
      statement_fr: String.raw`On considère la suite $(u_n)$ définie par $u_0 = 5$ et, pour tout entier naturel $n$, $u_{n+1} = \dfrac{1}{3}u_n + 2$.

1. a) Calculer $u_1$ et $u_2$. *(1 point)*
   b) Démontrer par récurrence que, pour tout entier naturel $n$, $u_n > 3$. *(1,5 point)*
2. Démontrer que la suite $(u_n)$ est décroissante. En déduire qu'elle converge. *(1,5 point)*
3. On pose, pour tout entier naturel $n$, $v_n = u_n - 3$.
   a) Montrer que la suite $(v_n)$ est géométrique de raison $\dfrac{1}{3}$. *(1 point)*
   b) Exprimer $u_n$ en fonction de $n$, puis calculer la limite de la suite $(u_n)$. *(1 point)*`,
      statement_ar: String.raw`نعتبر المتتالية $(u_n)$ المعرفة بـ $u_0 = 5$ ومن أجل كل عدد طبيعي $n$: $u_{n+1} = \dfrac{1}{3}u_n + 2$.

1. أ) احسب $u_1$ و $u_2$. *(1 نقطة)*
   ب) برهن بالتراجع أنه من أجل كل عدد طبيعي $n$: $u_n > 3$. *(1,5 نقطة)*
2. بين أن المتتالية $(u_n)$ متناقصة، ثم استنتج أنها متقاربة. *(1,5 نقطة)*
3. نضع من أجل كل عدد طبيعي $n$: $v_n = u_n - 3$.
   أ) بين أن المتتالية $(v_n)$ هندسية أساسها $\dfrac{1}{3}$. *(1 نقطة)*
   ب) اكتب $u_n$ بدلالة $n$، ثم احسب نهاية المتتالية $(u_n)$. *(1 نقطة)*`,
      solution_fr: String.raw`**1. a)** $u_1 = \dfrac{1}{3} \times 5 + 2 = \dfrac{11}{3}$ et $u_2 = \dfrac{1}{3} \times \dfrac{11}{3} + 2 = \dfrac{29}{9}$.

**1. b)** Initialisation : $u_0 = 5 > 3$.
Hérédité : supposons $u_n > 3$ pour un entier naturel $n$. Alors $\dfrac{1}{3}u_n > 1$, donc $u_{n+1} = \dfrac{1}{3}u_n + 2 > 3$.
Conclusion : pour tout entier naturel $n$, $u_n > 3$.

**2.** Pour tout entier naturel $n$ :
$$u_{n+1} - u_n = \dfrac{1}{3}u_n + 2 - u_n = -\dfrac{2}{3}u_n + 2 = -\dfrac{2}{3}\left(u_n - 3\right)$$
Comme $u_n > 3$, cette différence est négative : la suite est décroissante. Elle est décroissante et minorée par $3$, donc elle converge.

**3. a)** $v_{n+1} = u_{n+1} - 3 = \dfrac{1}{3}u_n - 1 = \dfrac{1}{3}\left(u_n - 3\right) = \dfrac{1}{3}v_n$. La suite $(v_n)$ est géométrique de raison $\dfrac{1}{3}$ et de premier terme $v_0 = 2$.

**3. b)** $v_n = 2\left(\dfrac{1}{3}\right)^n$, donc $u_n = 3 + 2\left(\dfrac{1}{3}\right)^n$. Comme $-1 < \dfrac{1}{3} < 1$, $\lim\limits_{n \to +\infty} \left(\dfrac{1}{3}\right)^n = 0$ et $\lim\limits_{n \to +\infty} u_n = 3$.`,
      solution_ar: String.raw`**1. أ)** $u_1 = \dfrac{1}{3} \times 5 + 2 = \dfrac{11}{3}$ و $u_2 = \dfrac{1}{3} \times \dfrac{11}{3} + 2 = \dfrac{29}{9}$.

**1. ب)** المرحلة الابتدائية: $u_0 = 5 > 3$.
الوراثة: نفرض أن $u_n > 3$ من أجل عدد طبيعي $n$. إذن $\dfrac{1}{3}u_n > 1$، ومنه $u_{n+1} = \dfrac{1}{3}u_n + 2 > 3$.
الخلاصة: من أجل كل عدد طبيعي $n$، $u_n > 3$.

**2.** من أجل كل عدد طبيعي $n$:
$$u_{n+1} - u_n = \dfrac{1}{3}u_n + 2 - u_n = -\dfrac{2}{3}u_n + 2 = -\dfrac{2}{3}\left(u_n - 3\right)$$
بما أن $u_n > 3$ فهذا الفرق سالب، إذن المتتالية متناقصة. وهي متناقصة ومحدودة من الأسفل بالعدد $3$، إذن هي متقاربة.

**3. أ)** $v_{n+1} = u_{n+1} - 3 = \dfrac{1}{3}u_n - 1 = \dfrac{1}{3}\left(u_n - 3\right) = \dfrac{1}{3}v_n$. إذن المتتالية $(v_n)$ هندسية أساسها $\dfrac{1}{3}$ وحدها الأول $v_0 = 2$.

**3. ب)** $v_n = 2\left(\dfrac{1}{3}\right)^n$، ومنه $u_n = 3 + 2\left(\dfrac{1}{3}\right)^n$. بما أن $-1 < \dfrac{1}{3} < 1$ فإن $\lim\limits_{n \to +\infty} \left(\dfrac{1}{3}\right)^n = 0$ و $\lim\limits_{n \to +\infty} u_n = 3$.`,
    },
    {
      title_fr: "Exercice 2 : étude d'une fonction",
      title_ar: 'التمرين الثاني: دراسة دالة',
      points: 9,
      statement_fr: String.raw`Soit $f$ la fonction définie sur $\mathbb{R}$ par $f(x) = x - 1 + e^{-x}$. On note $(C)$ sa courbe représentative dans un repère orthonormé.

1. Déterminer les limites de $f$ en $+\infty$ et en $-\infty$. *(2 points)*
2. Calculer $f'(x)$, étudier son signe et dresser le tableau de variation de $f$. *(3 points)*
3. En déduire que, pour tout réel $x$, $e^{-x} \geq 1 - x$. *(1 point)*
4. Montrer que la droite $(D)$ d'équation $y = x - 1$ est asymptote à $(C)$ en $+\infty$ et étudier la position de $(C)$ par rapport à $(D)$. *(1,5 point)*
5. Déterminer une équation de la tangente à $(C)$ au point d'abscisse $-1$. *(1,5 point)*`,
      statement_ar: String.raw`لتكن $f$ الدالة المعرفة على $\mathbb{R}$ بـ $f(x) = x - 1 + e^{-x}$، و $(C)$ تمثيلها البياني في معلم متعامد ومتجانس.

1. عين نهايتي $f$ عند $+\infty$ وعند $-\infty$. *(2 نقطة)*
2. احسب $f'(x)$ وادرس إشارتها، ثم شكل جدول تغيرات الدالة $f$. *(3 نقاط)*
3. استنتج أنه من أجل كل عدد حقيقي $x$: $e^{-x} \geq 1 - x$. *(1 نقطة)*
4. بين أن المستقيم $(D)$ ذا المعادلة $y = x - 1$ مقارب للمنحنى $(C)$ عند $+\infty$، وادرس وضعية $(C)$ بالنسبة إلى $(D)$. *(1,5 نقطة)*
5. عين معادلة لمماس المنحنى $(C)$ عند النقطة ذات الفاصلة $-1$. *(1,5 نقطة)*`,
      solution_fr: String.raw`**1.** En $+\infty$ : $\lim\limits_{x \to +\infty} (x - 1) = +\infty$ et $\lim\limits_{x \to +\infty} e^{-x} = 0$, donc $\lim\limits_{x \to +\infty} f(x) = +\infty$.
En $-\infty$ : on écrit $f(x) = e^{-x}\left(1 + (x - 1)\,e^{x}\right)$. Or $\lim\limits_{x \to -\infty} e^{-x} = +\infty$ et $\lim\limits_{x \to -\infty} (x - 1)\,e^{x} = 0$, donc $\lim\limits_{x \to -\infty} f(x) = +\infty$.

**2.** $f'(x) = 1 - e^{-x}$.
$f'(x) \geq 0$ équivaut à $e^{-x} \leq 1$, c'est-à-dire $-x \leq 0$, soit $x \geq 0$.
Donc $f$ est décroissante sur $]-\infty\,;0]$ et croissante sur $[0\,;+\infty[$, avec $f(0) = 0 - 1 + 1 = 0$.

| $x$ | $-\infty$ | | $0$ | | $+\infty$ |
|---|---|---|---|---|---|
| $f'(x)$ | | $-$ | $0$ | $+$ | |
| $f(x)$ | $+\infty$ | décroît | $0$ | croît | $+\infty$ |

**3.** Le minimum de $f$ sur $\mathbb{R}$ est $f(0) = 0$. Donc, pour tout réel $x$, $f(x) \geq 0$, c'est-à-dire $x - 1 + e^{-x} \geq 0$, soit $e^{-x} \geq 1 - x$.

**4.** $f(x) - (x - 1) = e^{-x}$. Comme $\lim\limits_{x \to +\infty} e^{-x} = 0$, la droite $(D)$ est asymptote à $(C)$ en $+\infty$. Comme $e^{-x} > 0$ pour tout réel $x$, la courbe $(C)$ est au-dessus de $(D)$ sur $\mathbb{R}$.

**5.** $f(-1) = -1 - 1 + e = e - 2$ et $f'(-1) = 1 - e$. La tangente a pour équation
$$y = (1 - e)(x + 1) + e - 2 = (1 - e)\,x - 1$$`,
      solution_ar: String.raw`**1.** عند $+\infty$: $\lim\limits_{x \to +\infty} (x - 1) = +\infty$ و $\lim\limits_{x \to +\infty} e^{-x} = 0$، إذن $\lim\limits_{x \to +\infty} f(x) = +\infty$.
عند $-\infty$: نكتب $f(x) = e^{-x}\left(1 + (x - 1)\,e^{x}\right)$. لدينا $\lim\limits_{x \to -\infty} e^{-x} = +\infty$ و $\lim\limits_{x \to -\infty} (x - 1)\,e^{x} = 0$، إذن $\lim\limits_{x \to -\infty} f(x) = +\infty$.

**2.** $f'(x) = 1 - e^{-x}$.
$f'(x) \geq 0$ يكافئ $e^{-x} \leq 1$ أي $-x \leq 0$ أي $x \geq 0$.
إذن $f$ متناقصة على $]-\infty\,;0]$ ومتزايدة على $[0\,;+\infty[$، مع $f(0) = 0 - 1 + 1 = 0$.

| $x$ | $-\infty$ | | $0$ | | $+\infty$ |
|---|---|---|---|---|---|
| $f'(x)$ | | $-$ | $0$ | $+$ | |
| $f(x)$ | $+\infty$ | متناقصة | $0$ | متزايدة | $+\infty$ |

**3.** القيمة الحدية الصغرى للدالة $f$ على $\mathbb{R}$ هي $f(0) = 0$. إذن من أجل كل عدد حقيقي $x$: $f(x) \geq 0$ أي $x - 1 + e^{-x} \geq 0$، ومنه $e^{-x} \geq 1 - x$.

**4.** $f(x) - (x - 1) = e^{-x}$. بما أن $\lim\limits_{x \to +\infty} e^{-x} = 0$ فالمستقيم $(D)$ مقارب للمنحنى $(C)$ عند $+\infty$. وبما أن $e^{-x} > 0$ من أجل كل عدد حقيقي $x$ فالمنحنى $(C)$ يقع فوق $(D)$ على $\mathbb{R}$.

**5.** $f(-1) = -1 - 1 + e = e - 2$ و $f'(-1) = 1 - e$. معادلة المماس هي
$$y = (1 - e)(x + 1) + e - 2 = (1 - e)\,x - 1$$`,
    },
    {
      title_fr: 'Exercice 3 : probabilités',
      title_ar: 'التمرين الثالث: الاحتمالات',
      points: 5,
      statement_fr: String.raw`Dans un lycée, 60 % des élèves de terminale suivent une filière scientifique. Parmi eux, 70 % révisent avec un planning. Parmi les autres élèves de terminale, 40 % révisent avec un planning. On choisit au hasard un élève de terminale. On note $S$ l'événement « l'élève suit une filière scientifique » et $R$ l'événement « l'élève révise avec un planning ».

1. Traduire les données par un arbre pondéré. *(1 point)*
2. Calculer $P(S \cap R)$. *(1 point)*
3. Montrer que $P(R) = 0{,}58$. *(1,5 point)*
4. L'élève choisi révise avec un planning. Quelle est la probabilité qu'il suive une filière scientifique ? Arrondir à $10^{-2}$. *(1,5 point)*`,
      statement_ar: String.raw`في ثانوية، 60 % من تلاميذ السنة الثالثة يدرسون في شعبة علمية. من بينهم 70 % يراجعون وفق مخطط مراجعة. ومن بين باقي تلاميذ السنة الثالثة، 40 % يراجعون وفق مخطط مراجعة. نختار عشوائيا تلميذا من السنة الثالثة. نسمي $S$ الحادثة «التلميذ يدرس في شعبة علمية» و $R$ الحادثة «التلميذ يراجع وفق مخطط مراجعة».

1. مثل المعطيات بشجرة احتمالات. *(1 نقطة)*
2. احسب $P(S \cap R)$. *(1 نقطة)*
3. بين أن $P(R) = 0{,}58$. *(1,5 نقطة)*
4. التلميذ المختار يراجع وفق مخطط مراجعة. ما احتمال أن يكون من شعبة علمية؟ تدور النتيجة إلى $10^{-2}$. *(1,5 نقطة)*`,
      solution_fr: String.raw`**1.** $P(S) = 0{,}6$ et $P(\overline{S}) = 0{,}4$. $P_S(R) = 0{,}7$ et $P_S(\overline{R}) = 0{,}3$. $P_{\overline{S}}(R) = 0{,}4$ et $P_{\overline{S}}(\overline{R}) = 0{,}6$.

**2.** $P(S \cap R) = P(S) \times P_S(R) = 0{,}6 \times 0{,}7 = 0{,}42$.

**3.** D'après la formule des probabilités totales :
$$P(R) = P(S \cap R) + P(\overline{S} \cap R) = 0{,}42 + 0{,}4 \times 0{,}4 = 0{,}42 + 0{,}16 = 0{,}58$$

**4.** $P_R(S) = \dfrac{P(S \cap R)}{P(R)} = \dfrac{0{,}42}{0{,}58} \approx 0{,}72$.`,
      solution_ar: String.raw`**1.** $P(S) = 0{,}6$ و $P(\overline{S}) = 0{,}4$. $P_S(R) = 0{,}7$ و $P_S(\overline{R}) = 0{,}3$. $P_{\overline{S}}(R) = 0{,}4$ و $P_{\overline{S}}(\overline{R}) = 0{,}6$.

**2.** $P(S \cap R) = P(S) \times P_S(R) = 0{,}6 \times 0{,}7 = 0{,}42$.

**3.** حسب دستور الاحتمالات الكلية:
$$P(R) = P(S \cap R) + P(\overline{S} \cap R) = 0{,}42 + 0{,}4 \times 0{,}4 = 0{,}42 + 0{,}16 = 0{,}58$$

**4.** $P_R(S) = \dfrac{P(S \cap R)}{P(R)} = \dfrac{0{,}42}{0{,}58} \approx 0{,}72$.`,
    },
  ] satisfies SeedExercise[],
};
