// 백신 정보 및 규칙
// standardIntervals: 각 차수별 표준 접종 시기 (개월 단위, 첫번째는 출생 시점 또는 시작 시점 기준)
// minIntervals: 각 차수별 최소 접종 간격 (주 단위 또는 'm'월 단위)
// doses: 총 접종 횟수
// rules: (ageInfo, history, vaccineId) => { action: 'skip'/'recommendNext'/'customMessage', message: '', nextDoseNumber: N }
//  - ageInfo: { years, months, days, totalMonths, totalWeeks, birthDate }
//  - history: [DateObjectOrNull, DateObjectOrNull, ...] (과거 접종일 배열)

const VACCINE_DATA = {
    bcg: {
        name: "결핵 (BCG)",
        doses: 1,
        standardIntervals: [{ months: 0, recommendedAgeMonths: 1 }], // 생후 1개월 이내 (4주 이내)
        minIntervals: [], // 1회 접종
        rules: (ageInfo, history) => {
            if (history[0]) return { action: 'completed', message: '완료' };
            if (ageInfo.totalWeeks <= 4) {
                return { action: 'recommendNext', nextDoseNumber: 1 };
            }
            return { action: 'consult', message: '4주 이내 접종 권장. 의사 상담 필요.' };
        }
    },
    hepB: {
        name: "B형 간염 (HepB)",
        doses: 3,
        standardIntervals: [{ months: 0 }, { months: 1 }, { months: 6 }], // 0, 1, 6개월
        minIntervals: [{ weeks: 4 }, { weeks: 8 }], // 1-2차: 4주, 2-3차: 8주 (추가조건: 1-3차 16주, 3차는 생후 24주 이후)
        rules: (ageInfo, history) => {
            const lastDoseIndex = history.slice().reverse().findIndex(d => d !== null);
            const numAdministered = history.filter(d => d).length;

            if (numAdministered === 3) return { action: 'completed', message: '완료' };
            
            if (numAdministered === 2) { // 3차 접종 시
                const firstDoseDate = history[0];
                const secondDoseDate = history[1];
                if (!firstDoseDate || !secondDoseDate) return {action: 'error', message: '이전 기록 오류'};

                const minAgeFor3rd = new Date(ageInfo.birthDate);
                minAgeFor3rd.setDate(minAgeFor3rd.getDate() + 24 * 7); // 생후 24주

                const minDateFrom1st = new Date(firstDoseDate);
                minDateFrom1st.setDate(minDateFrom1st.getDate() + 16 * 7); // 1차 후 16주

                const minDateFrom2nd = new Date(secondDoseDate);
                minDateFrom2nd.setDate(minDateFrom2nd.getDate() + 8 * 7); // 2차 후 8주
                
                const earliest3rdDose = new Date(Math.max(minAgeFor3rd, minDateFrom1st, minDateFrom2nd));

                return { action: 'recommendNext', nextDoseNumber: 3, minDateOverride: earliest3rdDose};
            }
            return { action: 'recommendNext', nextDoseNumber: numAdministered + 1 };
        }
    },
    dtap: {
        name: "디프테리아·파상풍·백일해 (DTaP)",
        doses: 5,
        standardIntervals: [{ months: 2 }, { months: 4 }, { months: 6 }, { months: 15 }, { ageYears: 4 }], // 2, 4, 6, 15-18개월, 만 4-6세
        minIntervals: [{ weeks: 4 }, { weeks: 4 }, { months: 6 }, { months: 6 }], // 1-2:4w, 2-3:4w, 3-4:6m, 4-5:6m
        rules: (ageInfo, history) => {
            const numAdministered = history.filter(d => d).length;
            if (numAdministered === 5) return { action: 'completed', message: '완료' };

            // 4차 접종을 만 4세 이후에 접종했다면 5차 접종은 생략
            if (numAdministered === 4 && history[3]) {
                const ageAt4thDose = calculateAgeAtDate(ageInfo.birthDate, history[3]);
                if (ageAt4thDose.years >= 4) {
                    return { action: 'completed', message: '4차를 만 4세 이후 접종하여 5차 생략' };
                }
            }
            // DTaP 3차와 4차 사이 최소 간격 6개월. 단, 4차 접종이 생후 12개월 이상에서 DTaP 3차와 4개월 이상 간격으로 실시되었으면 유효
            if (numAdministered === 3 && history[2]) { // 4차 접종 대상
                const ageAt3rdDoseCompletion = calculateAgeAtDate(ageInfo.birthDate, history[2]);
                if (ageAt3rdDoseCompletion.totalMonths >=12) { // 3차 접종 완료 시점이 12개월 이후고
                   // 다음 4차 계산 시 최소 간격을 4개월로 조정할 수 있음 (여기선 표준/최소 분리하므로 최소 간격 로직에서 처리)
                }
            }
            return { action: 'recommendNext', nextDoseNumber: numAdministered + 1 };
        }
    },
    tdap: {
        name: "파상풍·디프테리아·백일해 (Tdap)", // Tdap/Td는 연령에 따라 구분
        doses: 1, // Tdap은 1회, 이후 Td
        standardIntervals: [{ ageYears: 11 }], // 만 11-12세
        minIntervals: [], // DTaP 마지막 접종 후 5년 이상 (Tdap-Td 간격은 10년)
        rules: (ageInfo, history, allVaccineHistories) => {
            const numAdministered = history.filter(d => d).length;
            if (numAdministered >= 1) return { action: 'checkTd', message: 'Tdap 완료. Td 접종 고려.' };

            if (ageInfo.years >= 11) {
                const dtapHistory = allVaccineHistories.dtap || [null,null,null,null,null];
                const lastDtapDoseDate = dtapHistory.filter(d => d).pop();
                if (lastDtapDoseDate) {
                    const minTdapDate = new Date(lastDtapDoseDate);
                    minTdapDate.setFullYear(minTdapDate.getFullYear() + 5);
                    if (new Date() < minTdapDate) {
                        return { action: 'wait', message: `DTaP 최종 접종 후 5년 경과 필요 (${formatDate(minTdapDate)} 이후)`};
                    }
                }
                 return { action: 'recommendNext', nextDoseNumber: 1 };
            }
            return { action: 'wait', message: '만 11세 이후 권장' };
        }
    },
    td: {
        name: "파상풍·디프테리아 (Td)",
        doses: 1, // 반복 접종
        standardIntervals: [{ yearsInterval: 10 }], // Tdap 후 10년마다
        minIntervals: [],
        rules: (ageInfo, history, allVaccineHistories) => {
            const tdapHistory = allVaccineHistories.tdap || [null];
            const lastTdapDate = tdapHistory.filter(d => d).pop();
            const lastTdDate = history.filter(d => d).pop();

            let lastTetanusContainingDoseDate = null;
            if (lastTdDate) lastTetanusContainingDoseDate = lastTdDate;
            else if (lastTdapDate) lastTetanusContainingDoseDate = lastTdapDate;
            
            if (!lastTetanusContainingDoseDate) return { action: 'consult', message: 'Tdap 접종력이 확인되지 않음. 의사 상담 필요.'};

            const nextTdDate = new Date(lastTetanusContainingDoseDate);
            nextTdDate.setFullYear(nextTdDate.getFullYear() + 10);

            if (new Date() >= nextTdDate) {
                return { action: 'recommendNext', nextDoseNumber: (history.filter(d=>d).length || 0) + 1, recommendedDateOverride: nextTdDate };
            }
            return { action: 'wait', message: `다음 Td 권장일: ${formatDate(nextTdDate)}` };
        }
    },
    ipv: {
        name: "폴리오 (IPV)",
        doses: 4,
        standardIntervals: [{ months: 2 }, { months: 4 }, { months: 6 }, { ageYears: 4 }], // 2, 4, 6개월, 만 4-6세
        minIntervals: [{ weeks: 4 }, { weeks: 4 }, { months: 6 }],
        rules: (ageInfo, history) => {
            const numAdministered = history.filter(d => d).length;
            if (numAdministered === 4) return { action: 'completed', message: '완료' };

            // 3차 접종을 만 4세 이후에 실시할 경우, 2-3차 간격이 6개월 이상이면 3차로 완료 가능
            if (numAdministered === 3 && history[2]) {
                const ageAt3rdDose = calculateAgeAtDate(ageInfo.birthDate, history[2]);
                if (ageAt3rdDose.years >= 4) {
                    if (history[1]) {
                        const interval23 = diffInMonths(history[1], history[2]);
                        if (interval23 >= 6) {
                            return { action: 'completed', message: '3차를 만 4세 이후, 2-3차 6개월 이상 간격으로 접종하여 완료' };
                        }
                    }
                }
            }
            return { action: 'recommendNext', nextDoseNumber: numAdministered + 1 };
        }
    },
    hib: {
        name: "b형헤모필루스인플루엔자 (Hib)",
        doses: 4, // 또는 3회 (시작 연령에 따라 다름)
        standardIntervals: [{ months: 2 }, { months: 4 }, { months: 6 }, { months: 12 }], // 2, 4, 6, 12-15개월
        minIntervals: [{ weeks: 4 }, { weeks: 4 }, { weeks: 8 }], // 1-2:4w, 2-3:4w, 3-4(생후12개월이후):8w
        rules: (ageInfo, history) => {
            if (ageInfo.years >= 5) return { action: 'skip', message: '만 5세 이상 건강한 소아는 일반적으로 권장하지 않음' };
            const numAdministered = history.filter(d => d).length;
            
            // 지연접종 시 접종 횟수 변화 로직 (단순화된 접근)
            // 실제로는 각 차수 접종 시 연령을 따져야 함
            let requiredDoses = 4;
            const firstDoseDate = history[0];
            if (firstDoseDate) {
                const ageAtFirstDose = calculateAgeAtDate(ageInfo.birthDate, firstDoseDate);
                if (ageAtFirstDose.totalMonths >= 7 && ageAtFirstDose.totalMonths < 12) requiredDoses = 3; // 7-11개월 시작: 2회 기초 + 1회 추가
                else if (ageAtFirstDose.totalMonths >= 12 && ageAtFirstDose.totalMonths < 15) requiredDoses = 2; // 12-14개월 시작: 1회 기초 + 1회 추가 (간격 8주)
                else if (ageAtFirstDose.totalMonths >= 15 && ageAtFirstDose.totalMonths < 60) requiredDoses = 1; // 15-59개월 시작: 1회
            } else { // 첫 접종일 경우 현재 나이로 판단
                if (ageInfo.totalMonths >= 7 && ageInfo.totalMonths < 12) requiredDoses = 3;
                else if (ageInfo.totalMonths >= 12 && ageInfo.totalMonths < 15) requiredDoses = 2;
                else if (ageInfo.totalMonths >= 15 && ageInfo.totalMonths < 60) requiredDoses = 1;
            }


            if (numAdministered >= requiredDoses) return { action: 'completed', message: `연령 고려 ${requiredDoses}회 완료` };
            
            // 3차에서 4차(추가접종) 넘어갈 때 조건: 생후 12개월 이후 & 3차와 8주 간격
            if (numAdministered === 3 && requiredDoses === 4) { // 4차 접종 대상
                const minAgeForBooster = new Date(ageInfo.birthDate);
                minAgeForBooster.setMonth(minAgeForBooster.getMonth() + 12);
                return { action: 'recommendNext', nextDoseNumber: 4, minAgeOverride: minAgeForBooster };
            }

            return { action: 'recommendNext', nextDoseNumber: numAdministered + 1 };
        }
    },
    pcv: {
        name: "폐렴구균 단백결합 (PCV)",
        doses: 4, // 시작 연령에 따라 다름
        standardIntervals: [{ months: 2 }, { months: 4 }, { months: 6 }, { months: 12 }], // 2, 4, 6, 12-15개월
        minIntervals: [{ weeks: 4 }, { weeks: 4 }, { weeks: 8 }], // 1-2:4w, 2-3:4w, 3-4(생후12개월이후):8w
        rules: (ageInfo, history) => {
            if (ageInfo.years >= 5) return { action: 'skip', message: '만 5세 이상 건강한 소아는 일반적으로 권장하지 않음' };
            const numAdministered = history.filter(d => d).length;

            let requiredDoses = 4;
            const firstDoseDate = history[0];
             if (firstDoseDate) {
                const ageAtFirstDose = calculateAgeAtDate(ageInfo.birthDate, firstDoseDate);
                if (ageAtFirstDose.totalMonths >= 7 && ageAtFirstDose.totalMonths < 12) requiredDoses = 3; 
                else if (ageAtFirstDose.totalMonths >= 12 && ageAtFirstDose.totalMonths < 24) requiredDoses = 2; 
                else if (ageAtFirstDose.totalMonths >= 24 && ageAtFirstDose.totalMonths < 60) requiredDoses = 1; 
            } else { // 첫 접종일 경우 현재 나이로 판단
                if (ageInfo.totalMonths >= 7 && ageInfo.totalMonths < 12) requiredDoses = 3;
                else if (ageInfo.totalMonths >= 12 && ageInfo.totalMonths < 24) requiredDoses = 2;
                else if (ageInfo.totalMonths >= 24 && ageInfo.totalMonths < 60) requiredDoses = 1;
            }

            if (numAdministered >= requiredDoses) return { action: 'completed', message: `연령 고려 ${requiredDoses}회 완료` };
            
            if (numAdministered === (requiredDoses -1) && requiredDoses > 1 ) { // 마지막 추가 접종 시
                 const minAgeForBooster = new Date(ageInfo.birthDate);
                 // PCV 추가접종은 보통 12-15개월에. 생후 12개월 이후라는 조건 체크.
                 minAgeForBooster.setMonth(minAgeForBooster.getMonth() + 12);
                 return { action: 'recommendNext', nextDoseNumber: numAdministered + 1, minAgeOverride: minAgeForBooster };
            }
            return { action: 'recommendNext', nextDoseNumber: numAdministered + 1 };
        }
    },
    ppsv23: {
        name: "폐렴구균 23가 다당 (PPSV23)",
        doses: 1, // 또는 고위험군 2회
        standardIntervals: [{ ageYears: 2 }], // 고위험군 만 2세 이상
        minIntervals: [], // PCV13 접종 후 최소 8주
        rules: (ageInfo, history, allVaccineHistories) => {
            // 이 앱에서는 PPSV23은 고위험군 여부 판단이 불가하므로, 기본 1회 접종만 안내
            // "침습 폐렴구균 감염의 위험이 높은 상태에 있는 2세 이상의 소아에게 추천"
            const numAdministered = history.filter(d => d).length;
            if (numAdministered >= 1 && ageInfo.years >=2) { // 일단 1회 접종했으면 완료로 간주 (2차는 특수 케이스)
                return { action: 'completed', message: '1차 완료. 2차는 고위험군 해당 시 의사 상담.'};
            }
            if (ageInfo.years < 2) return { action: 'wait', message: '고위험군 만 2세 이상 권장'};

            const pcvHistory = allVaccineHistories.pcv || [null, null, null, null];
            const lastPcvDoseDate = pcvHistory.filter(d => d).pop();
            if (!lastPcvDoseDate) return { action: 'consult', message: 'PCV 접종력 확인 필요. 의사 상담.'};
            
            const minPpsvDate = new Date(lastPcvDoseDate);
            minPpsvDate.setDate(minPpsvDate.getDate() + 8 * 7); // PCV 마지막 접종 후 8주

            const minAgeDate = new Date(ageInfo.birthDate);
            minAgeDate.setFullYear(minAgeDate.getFullYear() + 2); // 만 2세 되는 날

            const earliestDate = new Date(Math.max(minPpsvDate, minAgeDate));

            if (new Date() < earliestDate) {
                 return { action: 'wait', message: `PCV 최종 접종 후 8주 경과 및 만 2세 이후 권장 (${formatDate(earliestDate)} 이후)`};
            }
            return { action: 'recommendNext', nextDoseNumber: 1, recommendedDateOverride: earliestDate };
        }
    },
    rv: {
        name: "로타바이러스 (RV)",
        doses: 3, // RV5 기준. RV1은 2회. (앱에서는 최대 3회로 가정)
        standardIntervals: [{ months: 2 }, { months: 4 }, { months: 6 }], // RV5: 2,4,6개월. RV1: 2,4개월
        minIntervals: [{ weeks: 4 }, { weeks: 4 }],
        rules: (ageInfo, history) => {
            const numAdministered = history.filter(d => d).length;
            const maxCompletionAgeInWeeks = 8 * 4 + 0; // 생후 8개월 0일 (32주)
            const maxCompletionDate = new Date(ageInfo.birthDate);
            maxCompletionDate.setDate(maxCompletionDate.getDate() + maxCompletionAgeInWeeks * 7);


            if (ageInfo.totalWeeks > maxCompletionAgeInWeeks ) {
                 if (numAdministered > 0) return { action: 'completed', message: '접종 완료 가능 시기 지남' };
                 return { action: 'skip', message: '접종 완료 가능 시기(생후 8개월 0일) 지남' };
            }

            if (numAdministered === 0) { // 첫 접종
                const maxFirstDoseAgeInWeeks = 14 * 7 + 6; // 생후 14주 6일
                const maxFirstDoseDate = new Date(ageInfo.birthDate);
                maxFirstDoseDate.setDate(maxFirstDoseDate.getDate() + maxFirstDoseAgeInWeeks);
                
                if (new Date() > maxFirstDoseDate) {
                    return { action: 'skip', message: '첫 접종 가능 시기(생후 14주 6일) 지남' };
                }
                 // 첫 접종은 생후 6주 이후여야 함
                const minFirstDoseAgeInWeeks = 6 * 7;
                const minFirstDoseDate = new Date(ageInfo.birthDate);
                minFirstDoseDate.setDate(minFirstDoseDate.getDate() + minFirstDoseAgeInWeeks);
                if (new Date() < minFirstDoseDate) {
                    return { action: 'wait', message: `첫 접종은 생후 6주 이후 (${formatDate(minFirstDoseDate)})부터, 14주 6일 이내 시작`};
                }
            }
            // 실제로는 RV1(2회), RV5(3회) 구분 필요. 여기서는 3회 기준으로 하되, 2회 접종 후 8개월 지났으면 완료 간주.
            if (numAdministered === 2 && ( (new Date() > maxCompletionDate) || ageInfo.totalWeeks > (8*4) ) ) { // RV1 2회 접종 완료로 간주할 수 있는 조건
                 return { action: 'completed', message: '2회 접종 후 접종 완료 가능 시기 도달 (RV1의 경우 완료)' };
            }
            if (numAdministered === 3) return { action: 'completed', message: '완료 (RV5 기준)' };

            return { action: 'recommendNext', nextDoseNumber: numAdministered + 1 };
        }
    },
    mmr: {
        name: "홍역·유행성이하선염·풍진 (MMR)",
        doses: 2,
        standardIntervals: [{ months: 12 }, { ageYears: 4 }], // 12-15개월, 만 4-6세
        minIntervals: [{ weeks: 4 }],
        rules: (ageInfo, history) => {
            const numAdministered = history.filter(d => d).length;
            if (numAdministered === 2) return { action: 'completed', message: '완료' };
            
            if (numAdministered === 0) { // 첫 접종
                const minAgeFor1st = new Date(ageInfo.birthDate);
                minAgeFor1st.setMonth(minAgeFor1st.getMonth() + 12); // 생후 12개월
                 if (new Date() < minAgeFor1st) {
                     // 유행 시 6-11개월 접종 가능하나, 그 경우도 12개월 이후 표준 접종 필요.
                     // 여기서는 표준 지연 접종이므로 12개월 이후 권장.
                     return { action: 'wait', message: `생후 12개월 이후 권장 (${formatDate(minAgeFor1st)} 이후)`};
                 }
            }
            if (numAdministered === 1 && history[0]) { // 2차 접종
                 const minAgeFor2ndStd = new Date(ageInfo.birthDate);
                 minAgeFor2ndStd.setFullYear(minAgeFor2ndStd.getFullYear() + 4); // 만 4세
                 // 유행시 최소 간격(4주)으로 접종 가능. 평시는 표준 시기.
                 // 여기서는 표준 지연 접종이므로, 만 4-6세를 기준으로 함.
                 // 단, 최소간격은 지켜야 하므로 1차 접종 후 4주는 지나야함.
                 const minDateAfter1st = new Date(history[0]);
                 minDateAfter1st.setDate(minDateAfter1st.getDate() + 4*7);

                 const recommendedDate = new Date(Math.max(minAgeFor2ndStd, minDateAfter1st));
                 
                 if (new Date() < recommendedDate && new Date() < minAgeFor2ndStd) {
                      return { action: 'wait', message: `2차는 통상 만 4-6세 권장. 최소 1차 접종 4주 후부터 가능. (${formatDate(minDateAfter1st)} 이후, 권장시작: ${formatDate(minAgeFor2ndStd)})`};
                 }
                 // 만약 만 4세가 이미 지났다면, 1차 접종 4주 후 바로 가능
                 if (ageInfo.years >=4 && new Date() >= minDateAfter1st) {
                    return { action: 'recommendNext', nextDoseNumber: 2, recommendedDateOverride: (new Date() > minDateAfter1st ? new Date() : minDateAfter1st) };
                 }
            }
            return { action: 'recommendNext', nextDoseNumber: numAdministered + 1 };
        }
    },
    var: {
        name: "수두 (VAR)",
        doses: 1, // 13세 미만 1회, 13세 이상은 2회
        standardIntervals: [{ months: 12 }], // 12-15개월
        minIntervals: [], // 13세 이상 2회 접종 시 4-8주 간격
        rules: (ageInfo, history) => {
            const numAdministered = history.filter(d => d).length;
            
            if (ageInfo.years < 13) {
                if (numAdministered === 1) return { action: 'completed', message: '완료 (13세 미만 1회)' };
                if (numAdministered === 0) {
                    const minAgeForDose = new Date(ageInfo.birthDate);
                    minAgeForDose.setMonth(minAgeForDose.getMonth() + 12);
                    if (new Date() < minAgeForDose) {
                        return { action: 'wait', message: `생후 12개월 이후 권장 (${formatDate(minAgeForDose)} 이후)`};
                    }
                    return { action: 'recommendNext', nextDoseNumber: 1 };
                }
            } else { // 13세 이상
                if (numAdministered === 2) return { action: 'completed', message: '완료 (13세 이상 2회)' };
                if (numAdministered === 0) {
                     // 13세 이상이면 첫 접종으로 1차 권고
                     return { action: 'recommendNext', nextDoseNumber: 1 };
                }
                if (numAdministered === 1) { // 2차 접종 대상 (4-8주 간격)
                    if (!history[0]) return {action: 'error', message: '1차 접종일 누락'};
                    const minIntervalFor2nd = new Date(history[0]);
                    minIntervalFor2nd.setDate(minIntervalFor2nd.getDate() + 4 * 7); // 최소 4주
                    return { action: 'recommendNext', nextDoseNumber: 2, minIntervalOverride: { weeks: 4 }};
                }
            }
            return { action: 'error', message: '상태 확인 불가' };
        }
    },
    hepA: {
        name: "A형 간염 (HepA)",
        doses: 2,
        standardIntervals: [{ months: 12 }, { monthsInterval: 6 }], // 12-23개월 첫 접종, 6-18(또는 36)개월 후 2차
        minIntervals: [{ months: 6 }],
        rules: (ageInfo, history) => {
            const numAdministered = history.filter(d => d).length;
            if (numAdministered === 2) return { action: 'completed', message: '완료' };

            if (numAdministered === 0) { // 첫 접종
                const minAgeFor1st = new Date(ageInfo.birthDate);
                minAgeFor1st.setMonth(minAgeFor1st.getMonth() + 12); // 생후 12개월
                if (new Date() < minAgeFor1st && ageInfo.totalMonths < 12) {
                     return { action: 'wait', message: `생후 12개월 이후 권장 (${formatDate(minAgeFor1st)} 이후)`};
                }
                 // 2세 이상 미접종자도 접종 가능
            }
             // 2차 접종 간격은 제품에 따라 6-36개월. 최소 6개월
            return { action: 'recommendNext', nextDoseNumber: numAdministered + 1 };
        }
    },
    ijev: {
        name: "일본뇌염 불활성화 (IJEV)",
        doses: 5, // 만 12세까지 5회
        // 표준: 12-23개월(1,2차), 2차 후 11개월(3차), 만6세(4차), 만12세(5차)
        standardIntervals: [
            { months: 12 }, // 1차
            { monthsInterval: 1 }, // 2차 (1차 후 1개월)
            { monthsInterval: 11 }, // 3차 (2차 후 11개월)
            { ageYears: 6 }, // 4차 (만 6세)
            { ageYears: 12 }  // 5차 (만 12세)
        ],
        minIntervals: [ // 1-2차:7일(가속시)or4주, 2-3차:11개월
            { weeks: 4 }, // 1-2차 기본 4주. 가속접종시 7일은 별도 UI로 처리해야 함. 여기서는 4주.
            { months: 11 }, // 2-3차
            { yearsInterval: 3 }, // 3-4차 (대략적인 최소값, 만6세 기준이 더 중요)
            { yearsInterval: 3 }  // 4-5차 (대략적인 최소값, 만12세 기준이 더 중요)
        ],
        rules: (ageInfo, history) => {
            const numAdministered = history.filter(d => d).length;

            // 연령 기반 완료 규칙
            if (history[2]) { // 3차 접종 완료
                const ageAt3rdDose = calculateAgeAtDate(ageInfo.birthDate, history[2]);
                if (ageAt3rdDose.years >= 10) return {action: 'completed', message: '3차를 만 10세 이후 접종하여 완료'};
            }
            if (history[3]) { // 4차 접종 완료
                const ageAt4thDose = calculateAgeAtDate(ageInfo.birthDate, history[3]);
                if (ageAt4thDose.years >= 10) return {action: 'completed', message: '4차를 만 10세 이후 접종하여 완료'};
            }
            if (numAdministered === 5) return { action: 'completed', message: '5회 완료' };

            // 11세 이후 기초접종 시작 시 총 3회로 완료
            if (numAdministered < 3) {
                const firstEverDoseDate = history.find(d => d);
                if (firstEverDoseDate) {
                    const ageAtFirstEverDose = calculateAgeAtDate(ageInfo.birthDate, firstEverDoseDate);
                    if (ageAtFirstEverDose.years >= 11 && numAdministered === 3) {
                         return { action: 'completed', message: '만 11세 이후 시작하여 3회 완료' };
                    }
                } else if (ageInfo.years >= 11 && numAdministered === 0) { // 아직 한 번도 안 맞았고 11세 이상
                    // 1차 추천, 총 3회 필요함을 명시
                }
            }


            if (numAdministered === 0) { // 첫 접종
                const minAgeFor1st = new Date(ageInfo.birthDate);
                minAgeFor1st.setMonth(minAgeFor1st.getMonth() + 12);
                if (new Date() < minAgeFor1st && ageInfo.totalMonths < 12) {
                    return { action: 'wait', message: `생후 12개월 이후 권장 (${formatDate(minAgeFor1st)} 이후)`};
                }
            }

            // 다음 차수 추천
            let nextDoseNumber = numAdministered + 1;
            let recommendedDateOverride = null;
            let minIntervalOverride = null;

            if (nextDoseNumber === 2 && history[0]) { // 2차
                // 가속접종: 1-2차 최소 7일. 표준 지연접종은 1개월(4주) 권장.
                // 이 스케줄러는 "지연"이므로 표준 간격인 4주를 최소로 봄.
                minIntervalOverride = { weeks: 4 };
            }
            if (nextDoseNumber === 4 && history[2]) { // 4차
                const targetAgeDate = new Date(ageInfo.birthDate);
                targetAgeDate.setFullYear(targetAgeDate.getFullYear() + 6); // 만 6세
                recommendedDateOverride = targetAgeDate; // 표준 접종일
            }
            if (nextDoseNumber === 5 && history[3]) { // 5차
                const targetAgeDate = new Date(ageInfo.birthDate);
                targetAgeDate.setFullYear(targetAgeDate.getFullYear() + 12); // 만 12세
                recommendedDateOverride = targetAgeDate;

                // 3차를 4-9세에 한 경우 4차는 (만6세에 못했더라도) 건너뛰고 5차를 만12세 이후에.
                // 복잡한 규칙: 3차를 4-9세에 한 경우 -> 4차(만6세)가 아니라 4차를 만12세 이후에 하고 종료(총4회)
                if (history[2]) {
                    const ageAt3rd = calculateAgeAtDate(ageInfo.birthDate, history[2]);
                    if (ageAt3rd.years >= 4 && ageAt3rd.years <=9) {
                         // 이때 4번째 접종(원래 5차)은 만 12세 이후.
                         if (nextDoseNumber === 4) { // 즉, 현재 3차까지 맞았고 다음이 4번째 접종일 때
                            const new5thTargetAge = new Date(ageInfo.birthDate);
                            new5thTargetAge.setFullYear(new5thTargetAge.getFullYear() + 12);
                            return { action: 'recommendNext', nextDoseNumber: 4, recommendedDateOverride: new5thTargetAge, messageOverride: "3차를 4-9세에 접종하여 다음 접종(4차)은 만 12세 이후 실시 후 종료" };
                         }
                    }
                }
            }
             // 11세 이후 시작 시 총 3회로 단축되는 부분 반영
            if (ageInfo.years >= 11) {
                const firstDose = history.find(d => d !== null);
                let ageAtFirstDoseYears = ageInfo.years; // 아직 안맞았으면 현재 나이
                if (firstDose) {
                    ageAtFirstDoseYears = calculateAgeAtDate(ageInfo.birthDate, firstDose).years;
                }
                if (ageAtFirstDoseYears >= 11 && numAdministered === 2) { // 3번째(마지막) 접종
                     return { action: 'recommendNext', nextDoseNumber: 3, messageOverride: "만 11세 이후 시작, 3회로 완료" };
                }
                 if (ageAtFirstDoseYears >= 11 && numAdministered >= 3) {
                     return { action: 'completed', message: '만 11세 이후 시작하여 3회 완료됨' };
                 }
            }


            return { action: 'recommendNext', nextDoseNumber, recommendedDateOverride, minIntervalOverride };
        }
    },
    liev: {
        name: "일본뇌염 생백신 (LIEV)",
        doses: 2,
        standardIntervals: [{ months: 12 }, { monthsInterval: 12 }], // 12-23개월(1차), 12개월 후 2차
        minIntervals: [{ months: 12 }], // 1-2차 12개월 (최소 4주 가능하나, 통상 12개월)
        rules: (ageInfo, history) => {
            const numAdministered = history.filter(d => d).length;
            if (numAdministered === 2) return { action: 'completed', message: '완료' };
             if (numAdministered === 0) { // 첫 접종
                const minAgeFor1st = new Date(ageInfo.birthDate);
                minAgeFor1st.setMonth(minAgeFor1st.getMonth() + 12);
                if (new Date() < minAgeFor1st && ageInfo.totalMonths < 12) {
                    return { action: 'wait', message: `생후 12개월 이후 권장 (${formatDate(minAgeFor1st)} 이후)`};
                }
            }
            // 2차 접종은 1차 후 12개월. 최소 간격은 4주도 언급되나, "12개월 후 2차"가 더 명확. 여기서는 12개월을 기준으로.
            return { action: 'recommendNext', nextDoseNumber: numAdministered + 1 };
        }
    },
    hpv: {
        name: "사람유두종바이러스 (HPV)",
        doses: 3, // 또는 2회 (연령에 따라)
        standardIntervals: [{ ageYears: 12 }], // 만 12세 시작 (표준 시작 연령)
        minIntervals: [ // 복잡함. 규칙에서 처리.
            // 9-14세 시작 2회: 1-2차 6개월 (최소 5개월)
            // 15세 이상 시작 3회: 1-2차 4주, 2-3차 12주, (1-3차 5개월 이상)
        ],
        rules: (ageInfo, history) => {
            const numAdministered = history.filter(d => d).length;
            const firstDoseDate = history[0];
            let ageAtFirstDoseYears = ageInfo.years; // 첫 접종 안했으면 현재 나이로 판단

            if (firstDoseDate) {
                ageAtFirstDoseYears = calculateAgeAtDate(ageInfo.birthDate, firstDoseDate).years;
            } else { // 아직 한 번도 안 맞았을 때 접종 시작 연령
                 if (ageInfo.years < 9) return { action: 'wait', message: '만 9세 이후 권장'};
            }
            
            const isTwoDoseRegimen = ageAtFirstDoseYears >= 9 && ageAtFirstDoseYears <= 14;
            const requiredDoses = isTwoDoseRegimen ? 2 : 3;

            if (numAdministered >= requiredDoses) return { action: 'completed', message: `${requiredDoses}회 완료` };

            let nextDoseNumber = numAdministered + 1;
            let minIntervalOverride = null;
            let messageOverride = null;

            if (isTwoDoseRegimen) { // 2회 요법
                messageOverride = "2회 접종 대상";
                if (nextDoseNumber === 2) minIntervalOverride = { months: 6, minMonths: 5 }; // 1-2차 6개월 (최소 5개월)
            } else { // 3회 요법
                messageOverride = "3회 접종 대상";
                if (nextDoseNumber === 2) minIntervalOverride = { weeks: 4 }; // 1-2차 4주
                if (nextDoseNumber === 3) {
                    minIntervalOverride = { weeks: 12 }; // 2-3차 12주
                    // 1-3차 5개월 이상 조건도 확인해야 함 (minDateOverride 로)
                    if (history[0]) {
                        const min3rdFrom1st = new Date(history[0]);
                        min3rdFrom1st.setMonth(min3rdFrom1st.getMonth() + 5);
                        return { action: 'recommendNext', nextDoseNumber, minIntervalOverride, minDateOverride: min3rdFrom1st, messageOverride };
                    }
                }
            }
             // HPV는 만 26세(여), 남성은 일부 백신 만 26세까지 허가. 이 앱은 소아청소년 대상이므로 상한 연령은 크게 고려 안함.

            return { action: 'recommendNext', nextDoseNumber, minIntervalOverride, messageOverride };
        }
    },
    iiv: {
        name: "인플루엔자 (IIV)",
        doses: 1, // 매년. 첫해는 2회 가능성
        standardIntervals: [{ isAnnual: true, startMonth: 9, endMonth: 12 }], // 통상 9-12월 접종
        minIntervals: [{ weeks: 4 }], // 첫 해 2회 접종 시 간격
        rules: (ageInfo, history) => { // history는 올해 기록만 의미있음
            if (ageInfo.totalMonths < 6) return { action: 'wait', message: '생후 6개월 이후 권장' };

            // "매년" 이므로, 과거 모든 기록보다는 올해/작년 기록이 중요.
            // 단순화를 위해 "올해 접종했는가?" 와 "첫해 2회 대상인가?"만 판단.
            const currentYear = new Date().getFullYear();
            const lastDoseThisSeason = history.find(d => d && d.getFullYear() === currentYear); // 올해 접종분
            // 실제로는 접종 시즌(예: 2024-2025 시즌)을 기준으로 해야 더 정확

            if (lastDoseThisSeason) { // 올해 이미 맞았다면
                // 만 9세 미만 첫해 2회 대상이었는지 확인 필요
                if (ageInfo.years < 9) {
                    // 이전에 인플루엔자 맞은적 있는지 확인 필요. 여기서는 단순화.
                    // 만약 lastDoseThisSeason이 유일한 기록이고, 4주 간격으로 2차 필요하다면...
                    // 이 로직은 복잡해서, "의사 상담" 또는 "1회 완료, 첫해 대상자는 2회 필요할 수 있음"으로 안내.
                     return { action: 'completed', message: '올해 접종. 만 9세 미만 첫 해 접종 시 2회 필요할 수 있음(의사 상담).' };
                }
                return { action: 'completed', message: '올해 접종 완료' };
            }

            // 올해 아직 안 맞음
            let dosesNeededThisYear = 1;
            let message = "매년 1회 권장";
            if (ageInfo.years < 9) {
                // 생애 첫 인플루엔자 접종인지 여부 판단 필요. (과거 모든 인플루엔자 기록이 없다고 가정)
                // 이 앱에서는 과거 모든 기록을 추적하지 않으므로, "첫 해일 경우"로 가정.
                const isLikelyFirstTime = history.filter(d => d).length === 0; // 입력된 기록이 전혀 없다면 첫 해로 간주
                if (isLikelyFirstTime) {
                    dosesNeededThisYear = 2;
                    message = "생애 첫 접종(만 9세 미만): 4주 간격 2회 권장";
                }
            }

            if (dosesNeededThisYear === 2) {
                 // 1차 추천, 4주 후 2차 알림
                 return { action: 'recommendNext', nextDoseNumber: 1, messageOverride: message + " (1차)" };
            }
            return { action: 'recommendNext', nextDoseNumber: 1, messageOverride: message };
        }
    }
};

// Helper functions (script.js로 옮겨도 무방)
function calculateAgeAtDate(birthDate, atDate) {
    if (!birthDate || !atDate) return { years: 0, months: 0, days: 0, totalMonths: 0, totalWeeks: 0, birthDate: birthDate };
    
    let years = atDate.getFullYear() - birthDate.getFullYear();
    let months = atDate.getMonth() - birthDate.getMonth();
    let days = atDate.getDate() - birthDate.getDate();

    if (days < 0) {
        months--;
        days += new Date(atDate.getFullYear(), atDate.getMonth(), 0).getDate(); // days in previous month
    }
    if (months < 0) {
        years--;
        months += 12;
    }
    const totalMonths = years * 12 + months;
    const totalWeeks = Math.floor((atDate - birthDate) / (1000 * 60 * 60 * 24 * 7));
    return { years, months, days, totalMonths, totalWeeks, birthDate };
}

function diffInMonths(date1, date2) {
    if (!date1 || !date2) return 0;
    let d1 = new Date(date1);
    let d2 = new Date(date2);
    let months;
    months = (d2.getFullYear() - d1.getFullYear()) * 12;
    months -= d1.getMonth();
    months += d2.getMonth();
    // 일수까지 고려한 정확한 개월 수 차이 (예: 3월 15일과 4월 14일은 0개월)
    if (d2.getDate() < d1.getDate()) {
        months--;
    }
    return months <= 0 ? 0 : months;
}

function formatDate(date) {
    if (!date || !(date instanceof Date) || isNaN(date)) return 'N/A';
    return date.toISOString().split('T')[0];
}