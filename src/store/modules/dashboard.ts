/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { defineStore } from "pinia";
import { store } from "@/store";
import { LayoutConfig } from "@/types/dashboard";
import graph from "@/graph";
import { ConfigData } from "../data";
import { useAppStoreWithOut } from "@/store/modules/app";
import { useSelectorStore } from "@/store/modules/selectors";
import { NewControl, RespFields } from "../data";
import { Duration } from "@/types/app";
import axios, { AxiosResponse } from "axios";
import { cancelToken } from "@/utils/cancelToken";
interface DashboardState {
  showConfig: boolean;
  layout: LayoutConfig[];
  selectedGrid: Nullable<LayoutConfig>; // edit widgets
  entity: string;
  layerId: string;
  activedGridItem: string;
  durationTime: Duration;
  selectorStore: any;
}

export const dashboardStore = defineStore({
  id: "dashboard",
  state: (): DashboardState => ({
    layout: [ConfigData],
    showConfig: false,
    selectedGrid: null,
    entity: "",
    layerId: "",
    activedGridItem: "",
    durationTime: useAppStoreWithOut().durationTime,
    selectorStore: useSelectorStore(),
  }),
  actions: {
    setLayout(data: LayoutConfig[]) {
      this.layout = data;
    },
    addControl(type: string) {
      const newWidget: LayoutConfig = {
        ...NewControl,
        i: String(this.layout.length),
        type,
      };
      if (type === "Tab") {
        newWidget.h = 24;
        newWidget.children = [
          {
            name: "Tab1",
            children: [],
          },
          {
            name: "Tab2",
            children: [],
          },
        ];
      }
      this.layout = this.layout.map((d: LayoutConfig) => {
        d.y = d.y + newWidget.h;
        return d;
      });
      this.layout.push(newWidget);
      this.activedGridItem = newWidget.i;
    },
    addTabItem(item: LayoutConfig) {
      const idx = this.layout.findIndex((d: LayoutConfig) => d.i === item.i);
      if (!this.layout[idx].children) {
        return;
      }
      const len = this.layout[idx].children?.length || 0;
      const i = {
        name: "Tab" + (len + 1),
        children: [],
      };
      this.layout[idx].children?.push(i);
    },
    addTabWidget(tabIndex: number) {
      const activedGridItem = this.activedGridItem.split("-")[0];
      const idx = this.layout.findIndex(
        (d: LayoutConfig) => d.i === activedGridItem
      );
      if (idx < 0) {
        return;
      }
      const { children } = this.layout[idx].children[tabIndex];
      const newWidget = {
        x: 0,
        y: 0,
        w: 24,
        h: 12,
        i: String(children.length),
        type: "Widget",
        widget: {
          title: "Title",
        },
        graph: {},
        standard: {},
      };
      if (this.layout[idx].children) {
        const items = children.map((d: LayoutConfig) => {
          d.y = d.y + newWidget.h;
          return d;
        });
        items.push(newWidget);
        this.layout[idx].children[tabIndex].children = items;
      }
    },
    activeGridItem(index: string) {
      this.activedGridItem = index;
    },
    removeControls(item: LayoutConfig) {
      this.layout = this.layout.filter((d: LayoutConfig) => d.i !== item.i);
    },
    removeTabItem(item: LayoutConfig, index: number) {
      const idx = this.layout.findIndex((d: LayoutConfig) => d.i === item.i);
      if (this.layout[idx].children) {
        this.layout[idx].children?.splice(index, 1);
      }
    },
    setConfigPanel(show: boolean) {
      this.showConfig = show;
    },
    selectWidget(widget: Nullable<LayoutConfig>) {
      this.selectedGrid = widget;
    },
    setLayer(id: string) {
      this.layerId = id;
    },
    setEntity(type: string) {
      this.entity = type;
    },
    setConfigs(param: { [key: string]: unknown }) {
      const actived = this.activedGridItem.split("-");
      const index = this.layout.findIndex(
        (d: LayoutConfig) => actived[0] === d.i
      );

      if (actived.length === 3) {
        this.layout[index].children[actived[1]].children[actived[2]] = {
          ...this.layout[index],
          ...param,
        };
        this.selectedGrid = this.layout[index];
        return;
      }
      this.layout[index] = {
        ...this.layout[index],
        ...param,
      };
      this.selectedGrid = this.layout[index];
    },
    async fetchMetricType(item: string) {
      const res: AxiosResponse = await graph
        .query("queryTypeOfMetrics")
        .params({ name: item });

      return res.data;
    },
    async fetchMetricList(regex: string) {
      const res: AxiosResponse = await graph
        .query("queryMetrics")
        .params({ regex });

      return res.data;
    },
    async fetchMetricValue(config: LayoutConfig) {
      if (!(config.metrics && config.metrics.length)) {
        return;
      }
      const conditions: any = {
        duration: this.durationTime,
      };
      const variables: string[] = [`$duration: Duration!`];
      const { currentPod, currentService, currentDestPod, currentDestService } =
        this.selectorStore;
      const isRelation = [
        "ServiceRelation",
        "ServiceInstanceRelation",
        "EndpointRelation",
      ].includes(this.entity);
      const fragment = config.metrics.map((name: string, index: number) => {
        const metricTypes = config.metricTypes[index] || "";
        if (["readSampledRecords", "sortMetrics"].includes(metricTypes)) {
          variables.push(`$condition${index}: TopNCondition!`);
          conditions[`condition${index}`] = {
            name,
            parentService: currentService,
            normal: true,
            scope: this.entity,
            topN: Number(config.standard.maxItemNum || 10),
            order: config.standard.sortOrder || "DES",
          };
        } else {
          variables.push(`$condition${index}: MetricsCondition!`);
          conditions[`condition${index}`] = {
            name,
            entity: {
              scope: this.entity,
              serviceName: currentService,
              normal: true,
              serviceInstanceName: this.entity.includes("ServiceInstance")
                ? currentPod
                : undefined,
              endpointName: this.entity.includes("Endpoint")
                ? currentPod
                : undefined,
              destNormal: true,
              destServiceName: isRelation ? currentDestService : undefined,
              destServiceInstanceName:
                this.entity === "ServiceInstanceRelation"
                  ? currentDestPod
                  : undefined,
              destEndpointName:
                this.entity === "EndpointRelation" ? currentDestPod : undefined,
            },
          };
        }

        return `${name}${index}: ${metricTypes}(condition: $condition${index}, duration: $duration)${RespFields[metricTypes]}`;
      });
      const graphStr = `query queryData(${variables}) {${fragment}}`;
      const res: AxiosResponse = await axios.post(
        "/graphql",
        { query: graphStr, variables: { ...conditions } },
        { cancelToken: cancelToken() }
      );

      // const appStoreWithOut = useAppStoreWithOut();
      // const variable = {
      //   condition: {
      //     name: "service_resp_time",
      //     entity: {
      //       normal: true,
      //       scope: "Service",
      //       serviceName: "agentless::app",
      //     },
      //   },
      //   duration: appStoreWithOut.durationTime,
      // };
      // const res: AxiosResponse = await graph
      //   .query("readMetricsValues")
      //   .params(variable);

      return res.data;
    },
  },
});

export function useDashboardStore(): any {
  return dashboardStore(store);
}
