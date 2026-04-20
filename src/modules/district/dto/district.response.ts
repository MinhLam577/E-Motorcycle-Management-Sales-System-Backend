import { ResponseWard } from "src/modules/ward/dto/ward.response";

export class ResponseDistrict {
  name: string;
  code: number;
  division_type: string;
  codename: string;
  province_code: number;
  wards: ResponseWard[];
}