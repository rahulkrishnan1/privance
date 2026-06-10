/**
 * dataset.ts -- GENERATED FILE, do not edit by hand.
 * Generator: packages/core/scripts/generate-dataset.ts
 *
 * Annual real total returns for US stocks and bonds, in integer basis points.
 * End year: 2022
 *
 * Source:
 *   Robert Shiller via datasets/s-and-p-500 (ODC-PDDL / public domain)
 *   https://raw.githubusercontent.com/datasets/s-and-p-500/main/data/data.csv
 *   https://github.com/datasets/s-and-p-500
 *
 * Cross-check: Damodaran annual real returns 1928 onward
 *   https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html
 *
 * Return conventions:
 *   Stocks: January-to-January real price change plus January real dividend.
 *     Formula: (realPrice[y+1] + realDiv[y]) / realPrice[y] - 1
 *     realDiv[y] is Shiller's annual real dividend as stored (not monthly).
 *   Bonds: constant-maturity approximation from GS10 (10-year Treasury yield).
 *     nominal = couponYield - duration * deltaYield; then CPI-deflated.
 *     Duration approximation: (1/y)*(1-(1+y)^-10) for a par coupon bond.
 *   Values are integer basis points (1 bp = 0.01%).
 *
 * Integrity hash (sha-256 of this file's content): see dataset-hash.txt
 */

export interface ReturnRow {
  readonly year: number;
  /** Real total return for US stocks in basis points. */
  readonly stocksBps: number;
  /** Real total return for US bonds (GS10 constant-maturity) in basis points. */
  readonly bondsBps: number;
}

/**
 * Annual real returns, 1871 to 2022, in integer basis points.
 * row.year is the calendar year in which the return was earned (Jan to Jan).
 * 1 bps = 0.01%. Negative values indicate real losses.
 */
export const ANNUAL_RETURNS: readonly ReturnRow[] = [
  { year: 1871, stocksBps: 1367, bondsBps: 344 },
  { year: 1872, stocksBps: 824, bondsBps: 137 },
  { year: 1873, stocksBps: 132, bondsBps: 1131 },
  { year: 1874, stocksBps: 1176, bondsBps: 1660 },
  { year: 1875, stocksBps: 1149, bondsBps: 1538 },
  { year: 1876, stocksBps: -1437, bondsBps: 482 },
  { year: 1877, stocksBps: 1673, bondsBps: 2484 },
  { year: 1878, stocksBps: 2865, bondsBps: 1738 },
  { year: 1879, stocksBps: 2334, bondsBps: -1229 },
  { year: 1880, stocksBps: 3249, bondsBps: 1306 },
  { year: 1881, stocksBps: -723, bondsBps: -343 },
  { year: 1882, stocksBps: 542, bondsBps: 551 },
  { year: 1883, stocksBps: 203, bondsBps: 1225 },
  { year: 1884, stocksBps: -240, bondsBps: 1643 },
  { year: 1885, stocksBps: 3420, bondsBps: 857 },
  { year: 1886, stocksBps: 1189, bondsBps: 211 },
  { year: 1887, stocksBps: -518, bondsBps: -237 },
  { year: 1888, stocksBps: 806, bondsBps: 1050 },
  { year: 1889, stocksBps: 1218, bondsBps: 888 },
  { year: 1890, stocksBps: -814, bondsBps: -73 },
  { year: 1891, stocksBps: 2578, bondsBps: 1044 },
  { year: 1892, stocksBps: -152, bondsBps: -503 },
  { year: 1893, stocksBps: -694, bondsBps: 2013 },
  { year: 1894, stocksBps: 837, bondsBps: 1018 },
  { year: 1895, stocksBps: 394, bondsBps: 91 },
  { year: 1896, stocksBps: 616, bondsBps: 835 },
  { year: 1897, stocksBps: 1660, bondsBps: 86 },
  { year: 1898, stocksBps: 2656, bondsBps: 389 },
  { year: 1899, stocksBps: -1087, bondsBps: -1214 },
  { year: 1900, stocksBps: 2233, bondsBps: 613 },
  { year: 1901, stocksBps: 1635, bondsBps: -4 },
  { year: 1902, stocksBps: -102, bondsBps: -680 },
  { year: 1903, stocksBps: -1349, bondsBps: 716 },
  { year: 1904, stocksBps: 2855, bondsBps: 43 },
  { year: 1905, stocksBps: 2078, bondsBps: 390 },
  { year: 1906, stocksBps: -390, bondsBps: -293 },
  { year: 1907, stocksBps: -2256, bondsBps: 426 },
  { year: 1908, stocksBps: 3442, bondsBps: 149 },
  { year: 1909, stocksBps: 501, bondsBps: -741 },
  { year: 1910, stocksBps: 299, bondsBps: 1084 },
  { year: 1911, stocksBps: 448, bondsBps: 487 },
  { year: 1912, stocksBps: 21, bondsBps: -642 },
  { year: 1913, stocksBps: -664, bondsBps: 462 },
  { year: 1914, stocksBps: -584, bondsBps: 249 },
  { year: 1915, stocksBps: 2676, bondsBps: 271 },
  { year: 1916, stocksBps: -410, bondsBps: -881 },
  { year: 1917, stocksBps: -3107, bondsBps: -1517 },
  { year: 1918, stocksBps: 181, bondsBps: -1081 },
  { year: 1919, stocksBps: 339, bondsBps: -1384 },
  { year: 1920, stocksBps: -1222, bondsBps: 568 },
  { year: 1921, stocksBps: 2254, bondsBps: 2498 },
  { year: 1922, stocksBps: 2900, bondsBps: 444 },
  { year: 1923, stocksBps: 210, bondsBps: 366 },
  { year: 1924, stocksBps: 2584, bondsBps: 568 },
  { year: 1925, stocksBps: 2079, bondsBps: 180 },
  { year: 1926, stocksBps: 1316, bondsBps: 892 },
  { year: 1927, stocksBps: 3753, bondsBps: 462 },
  { year: 1928, stocksBps: 4790, bondsBps: 225 },
  { year: 1929, stocksBps: -921, bondsBps: 617 },
  { year: 1930, stocksBps: -1637, bondsBps: 1063 },
  { year: 1931, stocksBps: -3620, bondsBps: 1173 },
  { year: 1932, stocksBps: 425, bondsBps: 1831 },
  { year: 1933, stocksBps: 5227, bondsBps: 252 },
  { year: 1934, stocksBps: -1055, bondsBps: 280 },
  { year: 1935, stocksBps: 5130, bondsBps: 249 },
  { year: 1936, stocksBps: 2860, bondsBps: 21 },
  { year: 1937, stocksBps: -3201, bondsBps: 299 },
  { year: 1938, stocksBps: 1912, bondsBps: 580 },
  { year: 1939, stocksBps: 321, bondsBps: 443 },
  { year: 1940, stocksBps: -1038, bondsBps: 304 },
  { year: 1941, stocksBps: -1760, bondsBps: -1256 },
  { year: 1942, stocksBps: 1284, bondsBps: -490 },
  { year: 1943, stocksBps: 1992, bondsBps: -56 },
  { year: 1944, stocksBps: 1646, bondsBps: 112 },
  { year: 1945, stocksBps: 3541, bondsBps: 167 },
  { year: 1946, stocksBps: -2485, bondsBps: -1395 },
  { year: 1947, stocksBps: -686, bondsBps: -877 },
  { year: 1948, stocksBps: 796, bondsBps: 229 },
  { year: 1949, stocksBps: 1840, bondsBps: 440 },
  { year: 1950, stocksBps: 2307, bondsBps: -738 },
  { year: 1951, stocksBps: 1632, bondsBps: -261 },
  { year: 1952, stocksBps: 1366, bondsBps: 100 },
  { year: 1953, stocksBps: 155, bondsBps: 466 },
  { year: 1954, stocksBps: 4660, bondsBps: 210 },
  { year: 1955, stocksBps: 2790, bondsBps: -29 },
  { year: 1956, stocksBps: 370, bondsBps: -474 },
  { year: 1957, stocksBps: -883, bondsBps: 282 },
  { year: 1958, stocksBps: 3773, bondsBps: -612 },
  { year: 1959, stocksBps: 642, bondsBps: -266 },
  { year: 1960, stocksBps: 440, bondsBps: 974 },
  { year: 1961, stocksBps: 1815, bondsBps: 120 },
  { year: 1962, stocksBps: -411, bondsBps: 470 },
  { year: 1963, stocksBps: 1889, bondsBps: -59 },
  { year: 1964, stocksBps: 1457, bondsBps: 301 },
  { year: 1965, stocksBps: 924, bondsBps: -109 },
  { year: 1966, stocksBps: -959, bondsBps: 134 },
  { year: 1967, stocksBps: 1199, bondsBps: -632 },
  { year: 1968, stocksBps: 588, bondsBps: -259 },
  { year: 1969, stocksBps: -1359, bondsBps: -1224 },
  { year: 1970, stocksBps: 182, bondsBps: 1235 },
  { year: 1971, stocksBps: 1035, bondsBps: 492 },
  { year: 1972, stocksBps: 1355, bondsBps: -141 },
  { year: 1973, stocksBps: -2313, bondsBps: -617 },
  { year: 1974, stocksBps: -2893, bondsBps: -751 },
  { year: 1975, stocksBps: 3008, bondsBps: -81 },
  { year: 1976, stocksBps: 566, bondsBps: 582 },
  { year: 1977, stocksBps: -1467, bondsBps: -453 },
  { year: 1978, stocksBps: 632, bondsBps: -822 },
  { year: 1979, stocksBps: 277, bondsBps: -1376 },
  { year: 1980, stocksBps: 1239, bondsBps: -1032 },
  { year: 1981, stocksBps: -1397, bondsBps: -643 },
  { year: 1982, stocksBps: 2429, bondsBps: 3079 },
  { year: 1983, stocksBps: 1545, bondsBps: -98 },
  { year: 1984, stocksBps: 388, bondsBps: 946 },
  { year: 1985, stocksBps: 2120, bondsBps: 1943 },
  { year: 1986, stocksBps: 2903, bondsBps: 2085 },
  { year: 1987, stocksBps: -584, bondsBps: -778 },
  { year: 1988, stocksBps: 1239, bondsBps: 121 },
  { year: 1989, stocksBps: 1667, bondsBps: 904 },
  { year: 1990, stocksBps: -610, bondsBps: 318 },
  { year: 1991, stocksBps: 2831, bondsBps: 1225 },
  { year: 1992, stocksBps: 424, bondsBps: 657 },
  { year: 1993, stocksBps: 885, bondsBps: 991 },
  { year: 1994, stocksBps: -165, bondsBps: -1184 },
  { year: 1995, stocksBps: 3139, bondsBps: 1897 },
  { year: 1996, stocksBps: 2328, bondsBps: -423 },
  { year: 1997, stocksBps: 2573, bondsBps: 1226 },
  { year: 1998, stocksBps: 2911, bondsBps: 987 },
  { year: 1999, stocksBps: 1242, bondsBps: -1285 },
  { year: 2000, stocksBps: -851, bondsBps: 1314 },
  { year: 2001, stocksBps: -1438, bondsBps: 488 },
  { year: 2002, stocksBps: -2204, bondsBps: 982 },
  { year: 2003, stocksBps: 2583, bondsBps: 129 },
  { year: 2004, stocksBps: 286, bondsBps: 60 },
  { year: 2005, stocksBps: 576, bondsBps: -132 },
  { year: 2006, stocksBps: 1086, bondsBps: -35 },
  { year: 2007, stocksBps: -540, bondsBps: 810 },
  { year: 2008, stocksBps: -3521, bondsBps: 1373 },
  { year: 2009, stocksBps: 2972, bondsBps: -1041 },
  { year: 2010, stocksBps: 1430, bondsBps: 482 },
  { year: 2011, stocksBps: 31, bondsBps: 1199 },
  { year: 2012, stocksBps: 1409, bondsBps: 90 },
  { year: 2013, stocksBps: 2332, bondsBps: -812 },
  { year: 2014, stocksBps: 1334, bondsBps: 1138 },
  { year: 2015, stocksBps: -472, bondsBps: -137 },
  { year: 2016, stocksBps: 1796, bondsBps: -336 },
  { year: 2017, stocksBps: 2215, bondsBps: -94 },
  { year: 2018, stocksBps: -620, bondsBps: -10 },
  { year: 2019, stocksBps: 2475, bondsBps: 824 },
  { year: 2020, stocksBps: 1592, bondsBps: 646 },
  { year: 2021, stocksBps: 1370, bondsBps: -1192 },
  { year: 2022, stocksBps: -1729, bondsBps: -1950 },
];

/** First year in the dataset. Uses Jan 1871 and Jan 1872 prices. */
export const DATASET_START_YEAR = 1871;

/** Last year in the dataset (2022). */
export const DATASET_END_YEAR = 2022;
