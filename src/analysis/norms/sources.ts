/**
 * Sources of the norms reference. Codes and trust marks come from the independent check
 * `research-norms.md` (2026-10-01): [О] — source opened, the number quoted verbatim;
 * [В] — the number taken from a secondary source that cites it; [Н] — could not be confirmed.
 */

export type SourceTrust = 'О' | 'В' | 'Н';

export interface NormSource {
  code: string;
  title: string;
  trust: SourceTrust;
  url?: string;
}

export const NORM_SOURCES: readonly NormSource[] = [
  {
    code: 'T&S-M',
    title:
      'Tilley L.P., Smith F.W.K. Jr. Electrocardiography (гл. 3, табл. 3-1) — Manual of Canine and Feline Cardiology, Elsevier; глава открыта на Veterian Key. Опорный источник.',
    trust: 'О',
    url: 'https://veteriankey.com/electrocardiography-2/',
  },
  {
    code: 'T92',
    title: 'Tilley L.P. Essentials of Canine and Feline Electrocardiography, 3rd ed., 1992 — через таблицу 1 CAR19.',
    trust: 'В',
  },
  {
    code: 'CAR19',
    title:
      'Carnabuci C. et al. Left shift of the ventricular mean electrical axis in healthy Doberman Pinschers. J Vet Med Sci 2019;81(4):620–625.',
    trust: 'О',
    url: 'https://www.jstage.jst.go.jp/article/jvms/81/4/81_18-0699/_pdf/-char/en',
  },
  {
    code: 'CHE17',
    title:
      'Черненок В.В. и др. Основы электрокардиографии животных: учебно-методическое пособие. Брянский ГАУ, 2017. Приложение 2.',
    trust: 'О',
    url: 'https://bgsha.com/upload/iblock/eea/19_30012018.pdf',
  },
  {
    code: 'FOX03',
    title: 'Fox P.R. Arrhythmia Identification and Treatment. WSAVA 2003 (VIN).',
    trust: 'О',
    url: 'https://www.vin.com/doc/?id=3850202',
  },
  {
    code: 'VAR-D',
    title: 'Varshney J.P. Electrocardiography in Veterinary Medicine, Springer 2020, гл. 5 (собаки), табл. 5.1.',
    trust: 'О',
    url: 'https://veteriankey.com/for-normal-electrocardiogram/',
  },
  {
    code: 'VAR-C',
    title: 'Varshney J.P. Electrocardiography in Veterinary Medicine, Springer 2020, гл. 17 (кошки).',
    trust: 'О',
    url: 'https://veteriankey.com/in-cats/',
  },
  {
    code: 'DUR22',
    title: 'Durham H.E. Jr. Overview of Electrocardiogram Interpretation. Today’s Veterinary Nurse, 2022.',
    trust: 'О',
    url: 'https://todaysveterinarynurse.com/cardiology/veterinary-electrocardiogram-interpretation/',
  },
  {
    code: 'KAT22',
    title:
      'Катарин И.А., Юшковский Е.А. Сравнение гемодинамических изменений при суправентрикулярных и вентрикулярных аритмиях у животных. Витебская ГАВМ, 2022 (вторичный источник без ссылки на первоисточник норм).',
    trust: 'О',
    url: 'https://repo.vsavm.by/bitstream/123456789/20901/1/k-2022-16-1-28-29.pdf',
  },
  {
    code: 'BRS',
    title: 'Brainscape, колода «Electrocardiography of the Dog and Cat» (неофициальный конспект).',
    trust: 'О',
    url: 'https://brainscape.com/flashcards/electrocardiography-of-the-dog-and-cat-18538165/packs/22786887',
  },
  {
    code: 'PER25',
    title:
      'Perego M. et al. QRS complex configurations in 12-lead ECGs of dogs with monomorphic ventricular tachycardia or complete bundle branch block. Front Vet Sci 2025.',
    trust: 'О',
    url: 'https://www.frontiersin.org/journals/veterinary-science/articles/10.3389/fvets.2025.1579951/full',
  },
  {
    code: 'ROM22',
    title:
      'Romito G. et al. Retrospective evaluation of the ST segment electrocardiographic features in 180 healthy dogs. J Small Anim Pract 2022;63:756–762.',
    trust: 'О',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9796018/',
  },
  {
    code: 'ALM23',
    title:
      'Almeida G.L.G. et al. The polarity and shape of the T wave in lead V-10 in Chihuahuas. Research, Society and Development 2023;12(10) (цитирует правило «T ≤ 25 % R» по Tilley 1992).',
    trust: 'О',
    url: 'https://rsdjournal.org/index.php/rsd/article/download/43367/34923/457252',
  },
  {
    code: '5MVC-SA',
    title: 'Tilley L.P., Smith F.W.K. Blackwell’s Five-Minute Veterinary Consult, 6th ed., тема «Sinus Arrhythmia».',
    trust: 'О',
    url: 'https://download.skyscape.com/download/ota/lonestar/E4105FE0-F4DD-4EF7-963E-12E351DF1C6F/fmvetcf.ed6/content/HTML/8/tn13.htm',
  },
  {
    code: '5MVC-VPC',
    title: 'Tilley L.P., Smith F.W.K. Blackwell’s Five-Minute Veterinary Consult, 6th ed., тема «Ventricular Premature Complexes».',
    trust: 'О',
    url: 'https://download.skyscape.com/download/ota/lonestar/E4105FE0-F4DD-4EF7-963E-12E351DF1C6F/fmvetcf.ed6/content/HTML/z/tu15.htm',
  },
  {
    code: 'KIT-MVM',
    title: 'Kittleson M.D. Heart Disease: Conduction Abnormalities in Dogs and Cats. Merck Veterinary Manual.',
    trust: 'О',
    url: 'https://www.merckvetmanual.com/circulatory-system/heart-disease-conduction-abnormalities-in-dogs-and-cats/heart-disease-conduction-abnormalities-in-dogs-and-cats',
  },
  {
    code: 'MIL13',
    title: 'Miller M.W. Electrocardiography: Diagnosis and Management of Common Arrhythmias. WSAVA 2013 (VIN).',
    trust: 'О',
    url: 'https://www.vin.com/doc/?id=5709868',
  },
  {
    code: 'ETT04',
    title: 'Ettinger S.J. Cardiac Arrhythmias — Diagnosis and Treatment. WSAVA 2004 (VIN).',
    trust: 'О',
    url: 'https://vin.com/doc/?id=3852129',
  },
  {
    code: 'SLE-CVMA',
    title: 'Sleeper M.M. The ABCs of ECGs: back to basics, part I (слайды, CVMA).',
    trust: 'О',
    url: 'https://canadianveterinarians.net/media/ijwezhtv/dr-meg-sleeper-the-abcs-of-ecgs-back-to-basics-part-i.pdf',
  },
  {
    code: 'CARV18',
    title:
      'Carvalho E.R. et al. Polymorphism, coupling interval and prematurity index in dogs with degenerative mitral valve disease and ventricular arrhythmias. Vet Res Commun 2018;42:153–160.',
    trust: 'О',
    url: 'https://repositorio.unesp.br/bitstream/11449/179674/1/2-s2.0-85043715327.pdf',
  },
  {
    code: 'HAN09',
    title:
      'Hanås S. et al. Twenty-four hour Holter monitoring of unsedated healthy cats in the home environment. J Vet Cardiol 2009;11(1):17–22.',
    trust: 'О',
    url: 'https://doi.org/10.1016/j.jvc.2008.10.003',
  },
  {
    code: 'HIL24',
    title: 'Hillen F., Locquet L. Possible sinoatrial node dysfunction in a 6-month-old domestic shorthair cat. JFMS Open Reports 2024.',
    trust: 'О',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11624554/',
  },
  {
    code: 'LIM14',
    title: 'Limprasutr V. et al. Relationship between RR and QT intervals in normal and pacing-induced heart failure dogs. Thai J Vet Med 2014.',
    trust: 'О',
    url: 'https://he01.tci-thaijo.org/index.php/tjvm/article/view/17312',
  },
  {
    code: 'SUL25',
    title:
      'Sullivan K.E. et al. Evaluation of maropitant-induced changes in the ECG of healthy dogs and comparison of three methods for QT interval correction. J Vet Emerg Crit Care 2025.',
    trust: 'О',
    url: 'https://pubmed.ncbi.nlm.nih.gov/40522750/',
  },
  {
    code: 'GON19',
    title: 'Gonul R. et al. Determination of corrected QT interval in Kangal breed dogs. Pak Vet J 2019 (формулы коррекции QT дословно).',
    trust: 'О',
    url: 'https://avesis.iuc.edu.tr/yayin/23a7299f-3aa8-4cff-b2fd-88cffffce9f1/determination-of-corrected-qt-interval-in-kangal-breed-dogs',
  },
  {
    code: 'GAR13',
    title:
      'Garncarz M. et al. Lead II electrocardiography in standing and right lateral recumbency in dogs with normal echocardiographic heart chamber values. Bull Vet Inst Pulawy 2013;57:263–267.',
    trust: 'О',
    url: 'https://reference-global.com/download/article/10.2478/bvip-2013-0046.pdf',
  },
  {
    code: 'FRE08',
    title: 'French A. Introduction to Electrocardiography. WSAVA 2008 (VIN).',
    trust: 'О',
    url: 'https://vin.com/doc/?id=3866623',
  },
  {
    code: 'AIS',
    title: 'Antech Imaging Services. ECG Best Practices (2025).',
    trust: 'О',
    url: 'https://www.antechdiagnostics.com/wp-content/uploads/2025/01/Customer-Guide-AIS-ECG-Guidelines.pdf',
  },
  {
    code: 'ПРОЕКТ',
    title: 'Допущение проекта: числового значения в открытых источниках не найдено; значение инженерное, подлежит уточнению.',
    trust: 'Н',
  },
];

export function findSource(code: string): NormSource | undefined {
  return NORM_SOURCES.find((s) => s.code === code);
}
