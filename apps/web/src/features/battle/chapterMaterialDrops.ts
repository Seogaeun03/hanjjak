import potatoFragment from "../equipment/assets/material-ranks/potato-fragment-f.png";
import potatoMini from "../equipment/assets/material-ranks/potato-mini-d.png";
import potato from "../equipment/assets/material-ranks/potato-c.png";
import potatoGolden from "../equipment/assets/material-ranks/potato-golden-b.png";
import sweetPotatoFragment from "../equipment/assets/material-ranks/sweet-potato-fragment-f.png";
import sweetPotatoMini from "../equipment/assets/material-ranks/sweet-potato-mini-d.png";
import sweetPotato from "../equipment/assets/material-ranks/sweet-potato-c.png";
import sweetPotatoGolden from "../equipment/assets/material-ranks/sweet-potato-golden-b.png";
import cornKernel from "../equipment/assets/material-ranks/corn-kernel-f.png";
import cornMini from "../equipment/assets/material-ranks/corn-mini-d.png";
import corn from "../equipment/assets/material-ranks/corn-c.png";
import cornGolden from "../equipment/assets/material-ranks/corn-golden-b.png";

export type ChapterMaterialDrop = {
  tier: number;
  label: string;
  items: { name: string; icon: string }[];
};

export type ChapterSkillBookDrop = {
  grade: "normal" | "rare" | "epic" | "legendary";
  label: string;
};

/*
 * 현재 서버에서 사용하는 progression-rebalance-v1 드롭표를 화면용 이름과
 * 아이콘으로 옮긴다. 한 세대 안에서는 주력 재료가 80%, 나머지가 각각 10%라
 * 세 계열 모두 실제 획득 가능하므로 한 묶음으로 함께 보여 준다.
 */
const MATERIAL_TIERS: ChapterMaterialDrop[] = [
  {
    tier: 1,
    label: "F등급",
    items: [
      { name: "감자 한 조각", icon: potatoFragment },
      { name: "고구마 한 조각", icon: sweetPotatoFragment },
      { name: "옥수수 한 알", icon: cornKernel },
    ],
  },
  {
    tier: 2,
    label: "D등급",
    items: [
      { name: "미니 감자", icon: potatoMini },
      { name: "미니 고구마", icon: sweetPotatoMini },
      { name: "미니 옥수수", icon: cornMini },
    ],
  },
  {
    tier: 3,
    label: "C등급",
    items: [
      { name: "감자", icon: potato },
      { name: "고구마", icon: sweetPotato },
      { name: "옥수수", icon: corn },
    ],
  },
  {
    tier: 4,
    label: "B등급",
    items: [
      { name: "황금 감자", icon: potatoGolden },
      { name: "황금 고구마", icon: sweetPotatoGolden },
      { name: "황금 옥수수", icon: cornGolden },
    ],
  },
];

const SKILL_BOOK_GRADES: ChapterSkillBookDrop[] = [
  { grade: "normal", label: "노말" },
  { grade: "rare", label: "희귀" },
  { grade: "epic", label: "영웅" },
  { grade: "legendary", label: "전설" },
];

/** 1장은 1세대, 2장은 2세대까지, 3장은 3세대까지, 4장부터(11~15장 포함)는 4세대까지 드롭한다. */
export function chapterMaterialDrops(chapter: number): ChapterMaterialDrop[] {
  if (chapter < 1 || chapter > 15) return [];
  return MATERIAL_TIERS.slice(0, Math.min(chapter, MATERIAL_TIERS.length));
}

/** 현재 서버는 1장 노말, 2~3장 희귀, 4~5장 영웅, 6장부터(11~15장 포함)는 전설까지 드롭한다. */
export function chapterSkillBookDrops(chapter: number): ChapterSkillBookDrop[] {
  if (chapter < 1 || chapter > 15) return [];
  const gradeCount = chapter === 1 ? 1 : chapter <= 3 ? 2 : chapter <= 5 ? 3 : 4;
  return SKILL_BOOK_GRADES.slice(0, gradeCount);
}
