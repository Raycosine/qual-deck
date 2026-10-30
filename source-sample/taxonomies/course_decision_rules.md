# Course Decision Rules: 535 vs 540

Use these rules when classifying a problem as 535 or 540.

## 540 = Algebraic Topology

Choose 540 when the problem mainly involves:

- Fundamental groups, Van Kampen, covering spaces
- Homotopy equivalence, deformation retracts, contractibility
- Higher homotopy groups
- Singular, cellular, or simplicial homology
- Singular cohomology, cup products, cohomology rings
- Exact sequences in homology or cohomology
- Mayer-Vietoris, excision, universal coefficient theorem, Kunneth formula
- Topological manifolds as objects of algebraic topology
- Poincare duality in a topological/algebraic topology setting
- Computing invariants of spheres, tori, projective spaces, surfaces, CW complexes

## 535 = Differential Geometry / Smooth Manifolds

Choose 535 when the problem mainly involves:

- Smooth manifolds, charts, atlases, smooth structures
- Smooth maps, diffeomorphisms, immersions, submersions, embeddings
- Tangent spaces, tangent bundles, cotangent bundles, differentials
- Vector fields, Lie brackets, integral curves, flows
- Lie groups, Lie algebras, Lie group actions, quotient manifolds
- Differential forms, exterior derivative, pullbacks, wedge products
- Orientations and integration on manifolds
- Stokes theorem for differential forms
- de Rham cohomology in a smooth/differential-forms setting
- Frobenius theorem, distributions, foliations
- Degree theory via smooth maps or differential forms
- Regular values, Sard theorem, transversality

## Ambiguous cases

Some topics can appear in both courses. Use the problem's language and tools to decide.

### Manifolds

- If the problem asks about smooth charts, tangent spaces, vector fields, forms, integration, or smooth maps, choose 535.
- If the problem asks about fundamental group, homology, cohomology, CW complexes, or topological invariants, choose 540.

### Degree

- If degree is defined using homology, choose 540.
- If degree is defined using regular values, orientations, or differential forms, choose 535.

### Poincare duality

- If framed as singular homology/cohomology of topological manifolds, choose 540.
- If framed via differential forms, de Rham theory, orientations, and integration, choose 535.

### de Rham cohomology

- Usually choose 535, especially if forms are central.
- If the problem explicitly compares de Rham cohomology to singular cohomology, include both "de Rham cohomology" and the relevant algebraic topology topic, but choose the dominant course.

## Output rule

If a problem genuinely mixes both courses:

- Set `course` to the dominant course.
- Set `secondary_course` to the other course.
- Set `needs_review` to true if the distinction is not clear.
